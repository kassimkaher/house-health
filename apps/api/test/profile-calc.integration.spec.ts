import "reflect-metadata";
import request from "supertest";
import { REDIS } from "@hh/auth";
import { ERROR_CODES } from "@hh/contracts";
import { createTestApp, truncateAllTables, type TestAppContext } from "@hh/testing";
import type Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/infra/prisma.service";

jest.setTimeout(120_000);

const PASSWORD = "s3cure-password";

const CALC_POLICY_V1 = {
  equation: "mifflin_st_jeor",
  activityMultipliers: { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 },
  kcalPerKgBodyMass: 7700,
  guardrails: {
    maxDailyDeficitKcal: 1000,
    maxDailySurplusKcal: 500,
    minCaloriesFemale: 1200,
    minCaloriesMale: 1500,
    minAgeYears: 18,
    maxAgeYears: 100,
    goalRateMaxKgPerWeek: 1.0,
  },
  macroDefaults: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  rounding: { calories: 10, macrosG: 1 },
  disclaimers: ["estimates_not_medical_advice"],
};

describe("profile & calc API (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    const redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();

    await prisma.calculationPolicy.create({
      data: { key: "mifflin_st_jeor", version: 1, isActive: true, config: CALC_POLICY_V1 },
    });

    const email = "profile@example.com";
    await request(http).post("/api/v1/auth/register").send({ email, password: PASSWORD }).expect(201);
    const token = ctx.email.lastTokenFor(email);
    await request(http).post("/api/v1/auth/verify-email").send({ token }).expect(200);
    const login = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    accessToken = login.body.accessToken;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const authed = () => ({ Authorization: `Bearer ${accessToken}` });

  it("serves an empty default profile", async () => {
    const res = await request(http).get("/api/v1/me/profile").set(authed()).expect(200);
    expect(res.body).toMatchObject({
      sex: null,
      timezone: "Asia/Baghdad",
      activityLevel: "sedentary",
      goalType: "maintain",
      unitPreference: "metric",
    });
  });

  it("rejects estimate while the profile is incomplete, listing missing fields", async () => {
    const res = await request(http).post("/api/v1/me/calc/estimate").set(authed()).expect(422);
    expect(res.body.code).toBe(ERROR_CODES.CALC_PROFILE_INCOMPLETE);
    const paths = res.body.fields.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["sex", "birthDate", "heightCm", "currentWeightKg"]));
  });

  it("updates the profile with validation", async () => {
    await request(http)
      .patch("/api/v1/me/profile")
      .set(authed())
      .send({ heightCm: 20 })
      .expect(422); // below minimum

    const res = await request(http)
      .patch("/api/v1/me/profile")
      .set(authed())
      .send({
        displayName: "اختبار",
        sex: "male",
        birthDate: "1996-08-01",
        heightCm: 180,
        activityLevel: "moderate",
        goalType: "lose",
        goalRateKgPerWeek: 0.5,
        targetWeightKg: 75,
        dietaryPrefs: ["halal"],
        medicalAck: true,
      })
      .expect(200);
    expect(res.body.sex).toBe("male");
    expect(res.body.medicalAckAt).toEqual(expect.any(String));
  });

  it("rejects unknown profile fields (strict schema)", async () => {
    const res = await request(http)
      .patch("/api/v1/me/profile")
      .set(authed())
      .send({ isAdmin: true })
      .expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("upserts weight by date and syncs profile.currentWeightKg", async () => {
    await request(http)
      .post("/api/v1/me/weight")
      .set(authed())
      .send({ measuredOn: "2026-07-25", weightKg: 82 })
      .expect(200);
    await request(http)
      .post("/api/v1/me/weight")
      .set(authed())
      .send({ measuredOn: "2026-08-01", weightKg: 80.6, note: "after ramadan" })
      .expect(200);
    // Same-date logging replaces, not duplicates.
    await request(http)
      .post("/api/v1/me/weight")
      .set(authed())
      .send({ measuredOn: "2026-08-01", weightKg: 80.5 })
      .expect(200);

    const list = await request(http).get("/api/v1/me/weight").set(authed()).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({ measuredOn: "2026-08-01", weightKg: 80.5 });

    const profile = await request(http).get("/api/v1/me/profile").set(authed()).expect(200);
    expect(profile.body.currentWeightKg).toBe(80.5);

    const trend = await request(http).get("/api/v1/me/weight/trend").set(authed()).expect(200);
    expect(trend.body.latest.weightKg).toBe(80.5);
    expect(trend.body.changeKg7d).toBe(-1.5);
    expect(trend.body.remainingToTargetKg).toBe(5.5);
  });

  it("computes an estimate, persists the snapshot, and explains itself", async () => {
    const res = await request(http).post("/api/v1/me/calc/estimate").set(authed()).expect(200);
    // male, 30y, 180cm, 80.5kg: BMR = 805+1125-150+5 = 1785; TDEE=1785*1.55=2766.75→2770
    expect(res.body.bmr).toBe(1785);
    expect(res.body.maintenanceKcal).toBe(2770);
    expect(res.body.targetKcal).toBe(2220); // 2766.75-550=2216.75→2220
    expect(res.body.policyVersion).toBe(1);
    expect(res.body.explanation.assumptions.length).toBeGreaterThan(0);
    expect(res.body.explanation.disclaimers).toContain("estimates_not_medical_advice");

    const current = await request(http).get("/api/v1/me/calc/current").set(authed()).expect(200);
    expect(current.body.id).toBe(res.body.id);
  });

  it("keeps historical snapshots stable when the policy changes", async () => {
    const first = await request(http).get("/api/v1/me/calc/current").set(authed()).expect(200);

    // Admin publishes policy v2 with different multipliers.
    await prisma.calculationPolicy.updateMany({ where: { key: "mifflin_st_jeor" }, data: { isActive: false } });
    await prisma.calculationPolicy.create({
      data: {
        key: "mifflin_st_jeor",
        version: 2,
        isActive: true,
        config: { ...CALC_POLICY_V1, activityMultipliers: { ...CALC_POLICY_V1.activityMultipliers, moderate: 1.6 } },
      },
    });

    const second = await request(http).post("/api/v1/me/calc/estimate").set(authed()).expect(200);
    expect(second.body.policyVersion).toBe(2);
    expect(second.body.maintenanceKcal).not.toBe(first.body.maintenanceKcal);

    // History preserves the v1 snapshot untouched.
    const history = await request(http).get("/api/v1/me/calc/history").set(authed()).expect(200);
    expect(history.body).toHaveLength(2);
    const v1 = history.body.find((s: { policyVersion: number }) => s.policyVersion === 1);
    expect(v1.maintenanceKcal).toBe(first.body.maintenanceKcal);
  });

  it("blocks cross-user weight access (IDOR)", async () => {
    const otherEmail = "other-profile@example.com";
    await request(http).post("/api/v1/auth/register").send({ email: otherEmail, password: PASSWORD }).expect(201);
    const token = ctx.email.lastTokenFor(otherEmail);
    await request(http).post("/api/v1/auth/verify-email").send({ token }).expect(200);
    const otherLogin = await request(http)
      .post("/api/v1/auth/login")
      .send({ email: otherEmail, password: PASSWORD })
      .expect(200);

    const mine = await request(http).get("/api/v1/me/weight").set(authed()).expect(200);
    const weightId = mine.body[0].id;

    await request(http)
      .patch(`/api/v1/me/weight/${weightId}`)
      .set({ Authorization: `Bearer ${otherLogin.body.accessToken}` })
      .send({ weightKg: 40 })
      .expect(404);
    await request(http)
      .delete(`/api/v1/me/weight/${weightId}`)
      .set({ Authorization: `Bearer ${otherLogin.body.accessToken}` })
      .expect(404);
  });
});
