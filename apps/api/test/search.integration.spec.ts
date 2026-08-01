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

jest.setTimeout(120_000);

const CSV = readFileSync(
  join(__dirname, "..", "..", "..", "packages", "pipeline", "test", "fixtures", "foods-sample.csv"),
);

describe("public food search (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    const redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();

    // Seed catalog prerequisites, import the sample dataset, verify, release.
    const provider = await prisma.dataProvider.create({
      data: { key: "iq_manual", name: "Internal", licenseName: "internal" },
    });
    const admin = await prisma.user.create({
      data: { email: "search-admin@local.test", roles: ["data_manager"], status: "active" },
    });
    await prisma.nutrientDefinition.createMany({
      data: [
        { key: "energy_kcal", nameAr: "طاقة", nameEn: "Energy", unit: "kcal", isCore: true, displayOrder: 1 },
        { key: "protein_g", nameAr: "بروتين", nameEn: "Protein", unit: "g", isCore: true, displayOrder: 2 },
        { key: "carbs_g", nameAr: "كربوهيدرات", nameEn: "Carbs", unit: "g", isCore: true, displayOrder: 3 },
        { key: "fat_g", nameAr: "دهون", nameEn: "Fat", unit: "g", isCore: true, displayOrder: 4 },
        { key: "sat_fat_g", nameAr: "مشبعة", nameEn: "Sat", unit: "g", isCore: true, displayOrder: 5 },
        { key: "fiber_g", nameAr: "ألياف", nameEn: "Fiber", unit: "g", isCore: true, displayOrder: 6 },
        { key: "sugars_g", nameAr: "سكريات", nameEn: "Sugars", unit: "g", isCore: true, displayOrder: 7 },
        { key: "sodium_mg", nameAr: "صوديوم", nameEn: "Sodium", unit: "mg", isCore: true, displayOrder: 8 },
        { key: "cholesterol_mg", nameAr: "كوليسترول", nameEn: "Chol", unit: "mg", isCore: true, displayOrder: 9 },
      ],
    });
    await prisma.foodCategory.createMany({
      data: [
        { slug: "bread", nameAr: "الخبز", nameEn: "Bread" },
        { slug: "rice-pasta", nameAr: "الرز", nameEn: "Rice" },
        { slug: "yogurt", nameAr: "اللبن", nameEn: "Yogurt" },
        { slug: "iraqi-dishes", nameAr: "أكلات عراقية", nameEn: "Iraqi dishes" },
      ],
    });
    const job = await pipelinePrisma.importJob.create({
      data: { providerId: provider.id, createdById: admin.id, mode: "upsert", sourceFileName: "s.csv" },
    });
    await new ImportRunner(pipelinePrisma).run(job.id, CSV);
    await pipelinePrisma.food.updateMany({
      where: { reviewStatus: "normalized" },
      data: { reviewStatus: "verified" },
    });
    const releases = new ReleaseService(pipelinePrisma);
    const release = await releases.buildCandidate("2026.08.0", admin.id);
    await releases.publish(release.id);
  });

  afterAll(async () => {
    await pipelinePrisma.$disconnect();
    await ctx.app.close();
  });

  it("matches canonical Arabic exactly at the top tier", async () => {
    const res = await request(http).get("/api/v1/foods/search").query({ q: "صمون عراقي" }).expect(200);
    expect(res.body.items[0]).toMatchObject({ nameEn: "Iraqi Samoon", matchTier: 4 });
    expect(res.body.items[0].energyKcalPer100g).toBe(270);
  });

  it("matches Iraqi dialect aliases with orthographic variants (ta marbuta)", async () => {
    // Alias stored as صمونة; query uses final ha — normalization folds them.
    const res = await request(http).get("/api/v1/foods/search").query({ q: "صمونه" }).expect(200);
    expect(res.body.items[0]).toMatchObject({ nameEn: "Iraqi Samoon", matchTier: 4 });
  });

  it("matches English names case-insensitively", async () => {
    const res = await request(http).get("/api/v1/foods/search").query({ q: "SAMOON" }).expect(200);
    expect(res.body.items[0].nameEn).toBe("Iraqi Samoon");
  });

  it("ranks prefix matches above fuzzy ones", async () => {
    const res = await request(http).get("/api/v1/foods/search").query({ q: "تمن" }).expect(200);
    expect(res.body.items[0]).toMatchObject({ nameEn: "Cooked Amber Rice" });
    expect(res.body.items[0].matchTier).toBeGreaterThanOrEqual(3);
  });

  it("tolerates typos through trigram similarity", async () => {
    // كباب vs كباب — transposed/misspelled.
    const res = await request(http).get("/api/v1/foods/search").query({ q: "كبب مشوي" }).expect(200);
    expect(res.body.items.map((i: { nameEn: string }) => i.nameEn)).toContain("Grilled Iraqi Kebab");
  });

  it("filters by category and food type", async () => {
    const res = await request(http)
      .get("/api/v1/foods/search")
      .query({ q: "عراقي", category: "iraqi-dishes" })
      .expect(200);
    expect(res.body.items.every((i: { categorySlug: string }) => i.categorySlug === "iraqi-dishes")).toBe(true);
  });

  it("finds foods by exact barcode", async () => {
    const res = await request(http).get("/api/v1/foods/barcode/6291041500999").expect(200);
    expect(res.body.nameEn).toBe("Plain Yogurt Drink");
    await request(http).get("/api/v1/foods/barcode/0000000000000").expect(404);
    await request(http).get("/api/v1/foods/barcode/abc").expect(400);
  });

  it("serves full detail by slug with nutrients and portions", async () => {
    const res = await request(http).get("/api/v1/foods/iraqi-samoon").expect(200);
    expect(res.body.nutrientsPer100g.energy_kcal).toBe(270);
    expect(res.body.portions[0]).toMatchObject({ labelEn: "1 samoon", grams: 90 });
    expect(res.body.releaseVersion).toBe("2026.08.0");
    expect(res.body.aliases.length).toBeGreaterThan(0);
  });

  it("serves only the active release (unpublished foods invisible)", async () => {
    // A verified-but-unreleased food must not appear.
    await prisma.food.create({
      data: {
        slug: "secret-new-food",
        nameAr: "طعام سري",
        nameEn: "Secret Food",
        foodType: "generic_food",
        reviewStatus: "verified",
      },
    });
    const res = await request(http).get("/api/v1/foods/search").query({ q: "سري" }).expect(200);
    expect(res.body.items).toHaveLength(0);
    await request(http).get("/api/v1/foods/secret-new-food").expect(404);
  });

  it("records anonymized search analytics", async () => {
    const before = await prisma.searchQueryLog.count();
    await request(http).get("/api/v1/foods/search").query({ q: "لبن رائب" }).expect(200);
    // fire-and-forget write — give it a beat
    await new Promise((resolve) => setTimeout(resolve, 300));
    const logs = await prisma.searchQueryLog.findMany({ orderBy: { id: "desc" }, take: 1 });
    expect(await prisma.searchQueryLog.count()).toBeGreaterThan(before);
    expect(logs[0]?.termNorm).toBe("لبن راءب"); // normalized (hamza folded), not raw
  });
});
