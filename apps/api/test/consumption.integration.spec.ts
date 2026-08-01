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

describe("recipes, meal groups, diary (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let accessToken: string;
  let adminId: string;
  let samoonFoodId: string;
  let riceFoodId: string;
  const releases = new ReleaseService(pipelinePrisma);

  const authed = () => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    const redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();

    const provider = await prisma.dataProvider.create({
      data: { key: "iq_manual", name: "Internal", licenseName: "internal" },
    });
    const admin = await prisma.user.create({
      data: { email: "cons-admin@local.test", roles: ["data_manager"], status: "active" },
    });
    adminId = admin.id;
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
    const release = await releases.buildCandidate("2026.08.0", admin.id);
    await releases.publish(release.id);

    samoonFoodId = (await prisma.food.findFirstOrThrow({ where: { nameEn: "Iraqi Samoon" } })).id;
    riceFoodId = (await prisma.food.findFirstOrThrow({ where: { nameEn: "Cooked Amber Rice" } })).id;

    const email = "diary-user@example.com";
    await request(http).post("/api/v1/auth/register").send({ email, password: PASSWORD }).expect(201);
    await request(http)
      .post("/api/v1/auth/verify-email")
      .send({ token: ctx.email.lastTokenFor(email) })
      .expect(200);
    accessToken = (
      await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await pipelinePrisma.$disconnect();
    await ctx.app.close();
  });

  let recipeId: string;
  let mealGroupId: string;

  it("creates a recipe with server-computed snapshots and totals", async () => {
    const res = await request(http)
      .post("/api/v1/recipes")
      .set(authed())
      .send({
        titleAr: "تشريب أحمر",
        titleEn: "Tashreeb",
        servings: 2,
        cookedWeightGrams: 800,
        ingredients: [
          { foodId: samoonFoodId, quantity: 2, unit: "portion" }, // 2 × 90g
          { foodId: riceFoodId, quantity: 300, unit: "g" },
        ],
      })
      .expect(201);
    recipeId = res.body.id;
    // samoon: 180g × 2.70 = 486 kcal; rice: 300g × 1.30 = 390 kcal → 876 total
    expect(res.body.nutritionTotals.total.energy_kcal).toBeCloseTo(876, 0);
    expect(res.body.nutritionTotals.perServing.energy_kcal).toBeCloseTo(438, 0);
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.ingredients[0].nutritionSnapshot.source.foodVersionId).toBeTruthy();
  });

  it("rejects unresolvable units instead of inventing conversions", async () => {
    const res = await request(http)
      .post("/api/v1/recipes")
      .set(authed())
      .send({
        titleAr: "خطأ",
        servings: 1,
        ingredients: [{ foodId: samoonFoodId, quantity: 100, unit: "ml" }], // no density
      })
      .expect(422);
    expect(res.body.code).toBe("food.unit_conversion_failed");
  });

  it("duplicates, archives, and restores recipes", async () => {
    const dup = await request(http).post(`/api/v1/recipes/${recipeId}/duplicate`).set(authed()).expect(201);
    expect(dup.body.titleAr).toContain("نسخة");
    await request(http).post(`/api/v1/recipes/${dup.body.id}/archive`).set(authed()).expect(200);
    const list = await request(http).get("/api/v1/recipes").set(authed()).expect(200);
    expect(list.body.some((r: { id: string }) => r.id === dup.body.id)).toBe(false);
    await request(http).post(`/api/v1/recipes/${dup.body.id}/restore`).set(authed()).expect(200);
  });

  it("creates a meal group and computes live totals", async () => {
    const res = await request(http)
      .post("/api/v1/meal-groups")
      .set(authed())
      .send({
        nameAr: "فطور اعتيادي",
        mealSlot: "breakfast",
        isFavorite: true,
        items: [
          { itemType: "food", foodId: samoonFoodId, quantity: 1, unit: "portion" },
          { itemType: "recipe", recipeId, quantity: 1, unit: "serving" },
        ],
      })
      .expect(201);
    mealGroupId = res.body.id;
    const totals = await request(http).get(`/api/v1/meal-groups/${mealGroupId}/totals`).set(authed()).expect(200);
    // 1 samoon (243) + 1 tashreeb serving (438) ≈ 681
    expect(totals.body.energy_kcal).toBeCloseTo(681, 0);
  });

  it("logs foods, recipes, and expands meal groups into the diary", async () => {
    const food = await request(http)
      .post("/api/v1/diary/entries")
      .set(authed())
      .send({ entryDate: "2026-08-01", mealSlot: "breakfast", itemType: "food", foodId: samoonFoodId, quantity: 1, unit: "portion" })
      .expect(201);
    expect(food.body).toHaveLength(1);
    expect(food.body[0].nutritionSnapshot.nutrients.energy_kcal).toBeCloseTo(243, 0);

    const recipe = await request(http)
      .post("/api/v1/diary/entries")
      .set(authed())
      .send({ entryDate: "2026-08-01", mealSlot: "lunch", itemType: "recipe", recipeId, quantity: 1, unit: "serving" })
      .expect(201);
    expect(recipe.body[0].nutritionSnapshot.nutrients.energy_kcal).toBeCloseTo(438, 0);

    const group = await request(http)
      .post("/api/v1/diary/entries")
      .set(authed())
      .send({ entryDate: "2026-08-01", mealSlot: "dinner", itemType: "meal_group", mealGroupId, quantity: 1, unit: "serving" })
      .expect(201);
    expect(group.body).toHaveLength(2); // expanded per item
    expect(group.body.every((e: { mealGroupId: string }) => e.mealGroupId === mealGroupId)).toBe(true);
  });

  it("summarizes the day with slot totals and target comparison", async () => {
    const day = await request(http).get("/api/v1/diary/day/2026-08-01").set(authed()).expect(200);
    expect(day.body.slots.breakfast.entries).toHaveLength(1);
    // 243 + 438 + 681 ≈ 1362
    expect(day.body.dayTotals.energy_kcal).toBeCloseTo(1362, 0);
    expect(day.body.target).toBeNull(); // no calc snapshot yet
  });

  it("moves, copies, and restores entries", async () => {
    const day = await request(http).get("/api/v1/diary/day/2026-08-01").set(authed()).expect(200);
    const entryId = day.body.slots.breakfast.entries[0].id;

    await request(http)
      .patch(`/api/v1/diary/entries/${entryId}`)
      .set(authed())
      .send({ mealSlot: "snack", status: "planned" })
      .expect(200);

    const copied = await request(http)
      .post("/api/v1/diary/copy")
      .set(authed())
      .send({ fromDate: "2026-08-01", toDate: "2026-08-02" })
      .expect(200);
    expect(copied.body.copied).toBe(4);

    await request(http).delete(`/api/v1/diary/entries/${entryId}`).set(authed()).expect(204);
    await request(http).post(`/api/v1/diary/entries/${entryId}/restore`).set(authed()).expect(200);
  });

  it("rebuilds edited quantities from the PINNED food version", async () => {
    const day = await request(http).get("/api/v1/diary/day/2026-08-02").set(authed()).expect(200);
    const foodEntry = day.body.slots.snack.entries.find((e: { itemType: string }) => e.itemType === "food");
    const updated = await request(http)
      .patch(`/api/v1/diary/entries/${foodEntry.id}`)
      .set(authed())
      .send({ quantity: 2 })
      .expect(200);
    expect(updated.body.nutritionSnapshot.nutrients.energy_kcal).toBeCloseTo(486, 0);
    expect(updated.body.nutritionSnapshot.source.foodVersionId).toBe(
      foodEntry.nutritionSnapshot.source.foodVersionId,
    );
  });

  it("GATE: historical diary nutrition is unchanged after a dataset update", async () => {
    const before = await request(http).get("/api/v1/diary/day/2026-08-01").set(authed()).expect(200);

    // Admin corrects samoon's calories (270 → 300) and publishes a new release.
    const samoon = await prisma.food.findFirstOrThrow({ where: { id: samoonFoodId }, include: { nutrients: { include: { nutrient: true } } } });
    const energyDef = samoon.nutrients.find((n) => n.nutrient.key === "energy_kcal")!;
    await prisma.foodNutrient.update({
      where: { foodId_nutrientId: { foodId: samoonFoodId, nutrientId: energyDef.nutrientId } },
      data: { valuePer100g: 300 },
    });
    await prisma.food.update({
      where: { id: samoonFoodId },
      data: {
        nutrientsDenorm: { ...(samoon.nutrientsDenorm as object), energy_kcal: 300 },
        reviewStatus: "verified",
      },
    });
    const v2 = await releases.buildCandidate("2026.08.1", adminId);
    await releases.publish(v2.id);

    // New logs see the new values...
    const fresh = await request(http)
      .post("/api/v1/diary/entries")
      .set(authed())
      .send({ entryDate: "2026-08-03", mealSlot: "breakfast", itemType: "food", foodId: samoonFoodId, quantity: 1, unit: "portion" })
      .expect(201);
    expect(fresh.body[0].nutritionSnapshot.nutrients.energy_kcal).toBeCloseTo(270, 0); // 90g × 3.00

    // ...but history is byte-identical.
    const after = await request(http).get("/api/v1/diary/day/2026-08-01").set(authed()).expect(200);
    expect(after.body.dayTotals).toEqual(before.body.dayTotals);
    expect(after.body.slots).toEqual(before.body.slots);
  });

  it("tracks favorites and recents", async () => {
    await request(http)
      .post("/api/v1/favorites")
      .set(authed())
      .send({ entityType: "food", entityId: samoonFoodId })
      .expect(200);
    const favs = await request(http).get("/api/v1/favorites").set(authed()).expect(200);
    expect(favs.body).toHaveLength(1);

    const recents = await request(http).get("/api/v1/recents").set(authed()).expect(200);
    expect(recents.body.length).toBeGreaterThanOrEqual(1);
    expect(recents.body[0].foodId).toBe(samoonFoodId); // most recently logged

    await request(http)
      .delete("/api/v1/favorites")
      .set(authed())
      .send({ entityType: "food", entityId: samoonFoodId })
      .expect(204);
  });

  it("blocks cross-user access to recipes and diary entries (IDOR)", async () => {
    const otherEmail = "other-cons@example.com";
    await request(http).post("/api/v1/auth/register").send({ email: otherEmail, password: PASSWORD }).expect(201);
    await request(http)
      .post("/api/v1/auth/verify-email")
      .send({ token: ctx.email.lastTokenFor(otherEmail) })
      .expect(200);
    const other = (
      await request(http).post("/api/v1/auth/login").send({ email: otherEmail, password: PASSWORD }).expect(200)
    ).body.accessToken;

    await request(http).get(`/api/v1/recipes/${recipeId}`).set({ Authorization: `Bearer ${other}` }).expect(404);
    await request(http)
      .get(`/api/v1/meal-groups/${mealGroupId}`)
      .set({ Authorization: `Bearer ${other}` })
      .expect(404);
  });
});
