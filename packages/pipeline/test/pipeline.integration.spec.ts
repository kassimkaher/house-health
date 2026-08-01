import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@hh/database";
import { ensureTestDatabaseMigrated, truncateAllTables } from "@hh/testing";
import { ImportRunner } from "../src/import/import-runner";
import { ReleaseService } from "../src/release";

jest.setTimeout(120_000);

const CSV = readFileSync(join(__dirname, "fixtures", "foods-sample.csv"));

describe("import pipeline + dataset releases (integration)", () => {
  let providerId: string;
  let adminId: string;
  const runner = new ImportRunner(prisma);
  const releases = new ReleaseService(prisma);

  async function createJob(overrides: { isDryRun?: boolean; mode?: "create_only" | "update_existing" | "upsert" } = {}) {
    return prisma.importJob.create({
      data: {
        providerId,
        createdById: adminId,
        mode: overrides.mode ?? "upsert",
        isDryRun: overrides.isDryRun ?? false,
        sourceFileName: "foods-sample.csv",
      },
    });
  }

  beforeAll(async () => {
    ensureTestDatabaseMigrated();
    await truncateAllTables(prisma);
    const provider = await prisma.dataProvider.create({
      data: { key: "iq_manual", name: "Internal Iraqi dataset", licenseName: "internal" },
    });
    providerId = provider.id;
    const admin = await prisma.user.create({
      data: { email: "pipeline-admin@local.test", roles: ["data_manager"], status: "active" },
    });
    adminId = admin.id;
    await prisma.nutrientDefinition.createMany({
      data: [
        { key: "energy_kcal", nameAr: "طاقة", nameEn: "Energy", unit: "kcal", isCore: true, displayOrder: 1 },
        { key: "protein_g", nameAr: "بروتين", nameEn: "Protein", unit: "g", isCore: true, displayOrder: 2 },
        { key: "carbs_g", nameAr: "كربوهيدرات", nameEn: "Carbs", unit: "g", isCore: true, displayOrder: 3 },
        { key: "fat_g", nameAr: "دهون", nameEn: "Fat", unit: "g", isCore: true, displayOrder: 4 },
        { key: "sat_fat_g", nameAr: "دهون مشبعة", nameEn: "Sat fat", unit: "g", isCore: true, displayOrder: 5 },
        { key: "fiber_g", nameAr: "ألياف", nameEn: "Fiber", unit: "g", isCore: true, displayOrder: 6 },
        { key: "sugars_g", nameAr: "سكريات", nameEn: "Sugars", unit: "g", isCore: true, displayOrder: 7 },
        { key: "sodium_mg", nameAr: "صوديوم", nameEn: "Sodium", unit: "mg", isCore: true, displayOrder: 8 },
        { key: "cholesterol_mg", nameAr: "كوليسترول", nameEn: "Cholesterol", unit: "mg", isCore: true, displayOrder: 9 },
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dry-run reports outcomes without writing foods", async () => {
    const job = await createJob({ isDryRun: true });
    const stats = await runner.run(job.id, CSV);
    expect(stats).toMatchObject({ created: 4, errors: 1, dryRun: true });
    expect(await prisma.food.count()).toBe(0);
    const finished = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe("partially_completed");
    const errorRows = await prisma.importJobRow.findMany({ where: { jobId: job.id, status: "error" } });
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0]?.rawData).toBeTruthy(); // raw kept for the error report
    expect(errorRows[0]?.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "energy_kcal" })]),
    );
  });

  it("imports valid rows with aliases, barcodes, portions, and provenance", async () => {
    const job = await createJob();
    const stats = await runner.run(job.id, CSV);
    expect(stats).toMatchObject({ created: 4, updated: 0, errors: 1 });

    const samoon = await prisma.food.findFirstOrThrow({
      where: { nameEn: "Iraqi Samoon" },
      include: { aliases: true, portions: true, nutrients: true, sourceRecords: true },
    });
    expect(samoon.reviewStatus).toBe("normalized");
    expect(samoon.aliases.map((a) => a.alias)).toEqual(expect.arrayContaining(["صمونة", "samoon"]));
    expect(samoon.portions[0]).toMatchObject({ labelEn: "1 samoon" });
    expect(samoon.nutrients).toHaveLength(9);
    expect(samoon.sourceRecords[0]).toMatchObject({ externalId: "IQ-0001", transformationVersion: "normalizer@1" });
    expect((samoon.nutrientsDenorm as Record<string, number>).energy_kcal).toBe(270);

    const laban = await prisma.food.findFirstOrThrow({
      where: { nameEn: "Plain Yogurt Drink" },
      include: { barcodes: true },
    });
    expect(laban.barcodes[0]).toMatchObject({ code: "6291041500999", isActive: true });
  });

  it("re-importing upserts by external id without duplicating", async () => {
    const before = await prisma.food.count();
    const job = await createJob();
    const stats = await runner.run(job.id, CSV);
    expect(stats).toMatchObject({ created: 0, updated: 4 });
    expect(await prisma.food.count()).toBe(before);
    const rows = await prisma.importJobRow.findMany({ where: { jobId: job.id, status: "updated" } });
    expect(rows.every((r) => r.matchMethod === "external_id")).toBe(true);
  });

  it("create_only mode skips matched rows as duplicates", async () => {
    const job = await createJob({ mode: "create_only" });
    const stats = await runner.run(job.id, CSV);
    expect(stats).toMatchObject({ created: 0, skippedDuplicate: 4, errors: 1 });
  });

  describe("release lifecycle", () => {
    let firstReleaseId: string;

    it("builds a candidate only from verified foods", async () => {
      await expect(releases.buildCandidate("2026.08.0", adminId)).rejects.toThrow(/no verified foods/);
      await prisma.food.updateMany({
        where: { nameEn: { in: ["Iraqi Samoon", "Cooked Amber Rice", "Plain Yogurt Drink"] } },
        data: { reviewStatus: "verified" },
      });
      const release = await releases.buildCandidate("2026.08.0", adminId, "first release");
      firstReleaseId = release.id;
      expect(release).toMatchObject({ status: "candidate", foodCount: 3, addedCount: 3 });
      expect(release.checksum).toHaveLength(64);

      const versions = await prisma.foodVersion.findMany();
      expect(versions).toHaveLength(3);
      // aliases_norm backfilled through the SQL normalizer.
      const samoonVersion = versions.find((v) => v.nameEn === "Iraqi Samoon")!;
      expect(samoonVersion.aliasesNorm).toEqual(expect.arrayContaining(["صمونه"]));
      expect((samoonVersion.nutrients as Record<string, number>).energy_kcal).toBe(270);
    });

    it("publishes atomically and flags the active read set", async () => {
      const published = await releases.publish(firstReleaseId);
      expect(published).toMatchObject({ status: "published", isActive: true });
      const activeCount = await prisma.foodVersion.count({ where: { isInActiveRelease: true } });
      expect(activeCount).toBe(3);
    });

    it("reuses unchanged versions and counts changes in the next release", async () => {
      const samoon = await prisma.food.findFirstOrThrow({ where: { nameEn: "Iraqi Samoon" } });
      await prisma.food.update({ where: { id: samoon.id }, data: { nameEn: "Iraqi Samoon Bread" } });
      // Kebab gets verified late and joins the second release.
      await prisma.food.updateMany({ where: { nameEn: "Grilled Iraqi Kebab" }, data: { reviewStatus: "verified" } });

      const second = await releases.buildCandidate("2026.08.1", adminId);
      expect(second).toMatchObject({ foodCount: 4, addedCount: 1, changedCount: 1 });
      // 3 old versions + 1 new samoon version + 1 kebab = 5 (rice/laban reused).
      expect(await prisma.foodVersion.count()).toBe(5);

      const cmp = await releases.compare(firstReleaseId, second.id);
      expect(cmp.added).toHaveLength(1);
      expect(cmp.changed).toHaveLength(1);
      expect(cmp.unchanged).toBe(2);

      await releases.publish(second.id);
      const activeNames = await prisma.foodVersion.findMany({
        where: { isInActiveRelease: true },
        select: { nameEn: true },
      });
      expect(activeNames.map((v) => v.nameEn).sort()).toEqual([
        "Cooked Amber Rice",
        "Grilled Iraqi Kebab",
        "Iraqi Samoon Bread",
        "Plain Yogurt Drink",
      ]);
    });

    it("rolls back to the prior release", async () => {
      const rolled = await releases.rollbackTo(firstReleaseId);
      expect(rolled).toMatchObject({ id: firstReleaseId, isActive: true, status: "published" });
      const active = await prisma.foodVersion.findMany({
        where: { isInActiveRelease: true },
        select: { nameEn: true },
      });
      expect(active.map((v) => v.nameEn).sort()).toEqual([
        "Cooked Amber Rice",
        "Iraqi Samoon",
        "Plain Yogurt Drink",
      ]);
      const second = await prisma.datasetRelease.findFirstOrThrow({ where: { version: "2026.08.1" } });
      expect(second.status).toBe("rolled_back");
    });

    it("archives inactive releases only", async () => {
      await expect(releases.archive(firstReleaseId)).rejects.toThrow(/active/);
      const second = await prisma.datasetRelease.findFirstOrThrow({ where: { version: "2026.08.1" } });
      const archived = await releases.archive(second.id);
      expect(archived.status).toBe("archived");
      // Provenance intact: versions never deleted.
      expect(await prisma.foodVersion.count()).toBe(5);
    });
  });
});
