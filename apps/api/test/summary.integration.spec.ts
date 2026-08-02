import "reflect-metadata";
import request from "supertest";
import { REDIS } from "@hh/auth";
import { prisma as pipelinePrisma } from "@hh/database";
import { ImportRunner, ReleaseService } from "@hh/pipeline";
import { createTestApp, truncateAllTables, type TestAppContext } from "@hh/testing";
import type Redis from "ioredis";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/infra/prisma.service";

jest.setTimeout(180_000);

const CSV = readFileSync(
  join(__dirname, "..", "..", "..", "packages", "pipeline", "test", "fixtures", "foods-sample.csv"),
);
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

describe("summaries & home (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let accessToken: string;
  let samoonFoodId: string;

  const authed = () => ({ Authorization: `Bearer ${accessToken}` });

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

    const provider = await prisma.dataProvider.create({
      data: { key: "iq_manual", name: "Internal", licenseName: "internal" },
    });
    const admin = await prisma.user.create({
      data: { email: "summary-admin@local.test", roles: ["data_manager"], status: "active" },
    });
    await prisma.nutrientDefinition.createMany({
      data: [
        { key: "energy_kcal", nameAr: "طاقة", nameEn: "Energy", unit: "kcal", isCore: true, displayOrder: 1 },
        { key: "protein_g", nameAr: "بروتين", nameEn: "Protein", unit: "g", isCore: true, displayOrder: 2 },
        { key: "carbs_g", nameAr: "كارب", nameEn: "Carbs", unit: "g", isCore: true, displayOrder: 3 },
        { key: "fat_g", nameAr: "دهون", nameEn: "Fat", unit: "g", isCore: true, displayOrder: 4 },
        { key: "sat_fat_g", nameAr: "مشبعة", nameEn: "Sat", unit: "g", isCore: true, displayOrder: 5 },
        { key: "fiber_g", nameAr: "ألياف", nameEn: "Fiber", unit: "g", isCore: true, displayOrder: 6 },
        { key: "sugars_g", nameAr: "سكر", nameEn: "Sugars", unit: "g", isCore: true, displayOrder: 7 },
        { key: "sodium_mg", nameAr: "صوديوم", nameEn: "Sodium", unit: "mg", isCore: true, displayOrder: 8 },
        { key: "cholesterol_mg", nameAr: "كول", nameEn: "Chol", unit: "mg", isCore: true, displayOrder: 9 },
      ],
    });
    const job = await pipelinePrisma.importJob.create({
      data: { providerId: provider.id, createdById: admin.id, mode: "upsert", sourceFileName: "s.csv" },
    });
    await new ImportRunner(pipelinePrisma).run(job.id, CSV);
    await pipelinePrisma.food.updateMany({ where: { reviewStatus: "normalized" }, data: { reviewStatus: "verified" } });
    const releases = new ReleaseService(pipelinePrisma);
    const release = await releases.buildCandidate("2026.08.0", admin.id);
    await releases.publish(release.id);
    samoonFoodId = (await prisma.food.findFirstOrThrow({ where: { nameEn: "Iraqi Samoon" } })).id;

    const email = "summary-user@example.com";
    await request(http).post("/api/v1/auth/register").send({ email, password: PASSWORD }).expect(201);
    await request(http)
      .post("/api/v1/auth/verify-email")
      .send({ token: ctx.email.lastTokenFor(email) })
      .expect(200);
    accessToken = (
      await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200)
    ).body.accessToken;

    await request(http)
      .patch("/api/v1/me/profile")
      .set(authed())
      .send({ sex: "male", birthDate: "1996-08-01", heightCm: 180, activityLevel: "sedentary", goalType: "lose", goalRateKgPerWeek: 1 })
      .expect(200);
    await request(http).post("/api/v1/me/weight").set(authed()).send({ measuredOn: "2026-08-01", weightKg: 80 }).expect(200);
    await request(http).post("/api/v1/me/calc/estimate").set(authed()).expect(200);
  });

  afterAll(async () => {
    await pipelinePrisma.$disconnect();
    await ctx.app.close();
  });

  it("returns a daily summary with guidance once far over target", async () => {
    // BMR male 30y 180cm 80kg = 1780; sedentary ×1.2=2136; deficit clamped to 1000 → target 1500 (min floor).
    // 7 samoon portions × 243 kcal = 1701 > 1500.
    for (let i = 0; i < 7; i += 1) {
      await request(http)
        .post("/api/v1/diary/entries")
        .set(authed())
        .send({ entryDate: "2026-08-02", mealSlot: "snack", itemType: "food", foodId: samoonFoodId, quantity: 1, unit: "portion" })
        .expect(201);
    }
    const res = await request(http).get("/api/v1/summary/daily/2026-08-02").set(authed()).expect(200);
    expect(res.body.target).not.toBeNull();
    expect(res.body.consumed.energy_kcal).toBeGreaterThan(res.body.target.targetKcal);
    expect(res.body.guidance.map((g: { ruleId: string }) => g.ruleId)).toContain("daily.over_target_kcal");
    expect(res.body.remainingKcal).toBeLessThan(0);
  });

  it("computes a 7-day average only over logged days", async () => {
    const res = await request(http).get("/api/v1/summary/week/2026-08-02").set(authed()).expect(200);
    expect(res.body.daysLogged).toBe(1);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.averages.energy_kcal).toBeGreaterThan(0);
  });

  it("reports weight trend guidance", async () => {
    // changeKg30d needs an entry at least 30 days before the latest one.
    await request(http).post("/api/v1/me/weight").set(authed()).send({ measuredOn: "2026-07-01", weightKg: 83 }).expect(200);
    await request(http).post("/api/v1/me/weight").set(authed()).send({ measuredOn: "2026-08-02", weightKg: 79.9 }).expect(200);
    const res = await request(http).get("/api/v1/summary/weight-trend").set(authed()).expect(200);
    expect(res.body.trend.changeKg30d).not.toBeNull();
    expect(res.body.guidance[0].ruleId).toMatch(/^weight\./);
  });

  it("serves the aggregated home payload in one call", async () => {
    const res = await request(http).get("/api/v1/home").set(authed()).expect(200);
    expect(res.body.today.date).toBe(new Date().toISOString().slice(0, 10));
    expect(res.body.recents.length).toBeGreaterThan(0);
    expect(res.body.profile).toBeDefined();
  });

  it("never returns a medical diagnosis field and always attaches disclaimers via calc explanation", async () => {
    const calc = await request(http).get("/api/v1/me/calc/current").set(authed()).expect(200);
    expect(calc.body.explanation.disclaimers).toContain("estimates_not_medical_advice");
    expect(JSON.stringify(calc.body).toLowerCase()).not.toContain("diagnos");
  });
});
