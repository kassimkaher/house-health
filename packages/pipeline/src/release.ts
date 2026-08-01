import { createHash } from "node:crypto";
import type { DatasetRelease, PrismaClientLike } from "@hh/database";
import { prisma as defaultPrisma } from "@hh/database";
import {
  VERSION_SOURCE_INCLUDE,
  buildCategoryPaths,
  buildFoodVersionPayload,
} from "./food-version";

export interface ReleaseComparison {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
}

export class ReleaseError extends Error {
  constructor(
    public readonly code:
      | "release.not_found"
      | "release.not_publishable"
      | "release.nothing_to_release"
      | "release.version_exists",
    message: string,
  ) {
    super(message);
    this.name = "ReleaseError";
  }
}

/**
 * Dataset release lifecycle. Build runs in the worker (potentially slow);
 * publish/rollback are fast advisory-locked flag flips callable from the API.
 */
export class ReleaseService {
  constructor(private readonly prisma: PrismaClientLike = defaultPrisma) {}

  /**
   * Create a release candidate from all verified, non-deleted foods. Reuses
   * FoodVersion rows whose content checksum is unchanged.
   */
  async buildCandidate(version: string, ownerId: string, notes?: string): Promise<DatasetRelease> {
    const existing = await this.prisma.datasetRelease.findUnique({ where: { version } });
    if (existing) throw new ReleaseError("release.version_exists", `release ${version} already exists`);

    const foods = await this.prisma.food.findMany({
      where: { reviewStatus: "verified", deletedAt: null },
      include: VERSION_SOURCE_INCLUDE,
    });
    if (foods.length === 0) {
      throw new ReleaseError("release.nothing_to_release", "no verified foods to release");
    }
    const categories = await this.prisma.foodCategory.findMany({
      select: { id: true, slug: true, parentId: true },
    });
    const categoryPaths = buildCategoryPaths(categories);

    const activeRelease = await this.prisma.datasetRelease.findFirst({ where: { isActive: true } });
    const activeItems = activeRelease
      ? await this.prisma.releaseItem.findMany({ where: { releaseId: activeRelease.id } })
      : [];
    const activeVersionByFood = new Map(activeItems.map((i) => [i.foodId, i.foodVersionId]));

    const release = await this.prisma.datasetRelease.create({
      data: { version, ownerId, notes: notes ?? null, status: "draft" },
    });

    let added = 0;
    let changed = 0;
    const checksumParts: string[] = [];

    for (const food of foods) {
      const { payload, contentChecksum } = buildFoodVersionPayload(food, categoryPaths);
      let foodVersion = await this.prisma.foodVersion.findFirst({
        where: { foodId: food.id, contentChecksum },
        orderBy: { versionNumber: "desc" },
      });
      if (!foodVersion) {
        const latest = await this.prisma.foodVersion.findFirst({
          where: { foodId: food.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        foodVersion = await this.prisma.foodVersion.create({
          data: {
            foodId: food.id,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            contentChecksum,
            slug: payload.slug,
            foodType: payload.foodType,
            nameAr: payload.nameAr,
            nameEn: payload.nameEn,
            descriptionAr: payload.descriptionAr,
            descriptionEn: payload.descriptionEn,
            aliasesNorm: [], // backfilled below via normalize_arabic
            aliasesDisplay: payload.aliasesDisplay,
            brandName: payload.brandName,
            categorySlug: payload.categorySlug,
            categoryPath: payload.categoryPath,
            preparationState: payload.preparationState,
            barcodes: payload.barcodes,
            defaultPortionGrams: payload.defaultPortionGrams,
            densityGPerMl: payload.densityGPerMl,
            edibleFraction: payload.edibleFraction,
            marketTags: payload.marketTags,
            dietaryTags: payload.dietaryTags,
            allergenTags: payload.allergenTags,
            ...(payload.imageRefs !== null ? { imageRefs: payload.imageRefs as object } : {}),
            nutrients: payload.nutrients,
            portions: payload.portions,
            dataConfidence: payload.dataConfidence,
          },
        });
        // aliases_norm must use the SAME normalizer as query time — the SQL fn.
        await this.prisma.$executeRaw`
          UPDATE food_versions fv SET aliases_norm = COALESCE(
            (SELECT array_agg(DISTINCT normalize_arabic(x.alias))
               FROM jsonb_to_recordset(fv.aliases_display) AS x(alias text)),
            '{}'
          ) WHERE fv.id = ${foodVersion.id}::uuid`;
      }

      const previousVersionId = activeVersionByFood.get(food.id);
      const changeKind = !previousVersionId
        ? "added"
        : previousVersionId === foodVersion.id
          ? "unchanged"
          : "changed";
      if (changeKind === "added") added += 1;
      else if (changeKind === "changed") changed += 1;

      await this.prisma.releaseItem.create({
        data: { releaseId: release.id, foodId: food.id, foodVersionId: foodVersion.id, changeKind },
      });
      checksumParts.push(`${food.id}:${contentChecksum}`);
    }

    const removedCount = activeItems.filter((i) => !foods.some((f) => f.id === i.foodId)).length;
    const checksum = createHash("sha256").update(checksumParts.sort().join("\n")).digest("hex");

    return this.prisma.datasetRelease.update({
      where: { id: release.id },
      data: {
        status: "candidate",
        foodCount: foods.length,
        addedCount: added,
        changedCount: changed,
        removedCount,
        checksum,
      },
    });
  }

  async compare(releaseIdA: string, releaseIdB: string): Promise<ReleaseComparison> {
    const [a, b] = await Promise.all([
      this.prisma.releaseItem.findMany({ where: { releaseId: releaseIdA } }),
      this.prisma.releaseItem.findMany({ where: { releaseId: releaseIdB } }),
    ]);
    const aByFood = new Map(a.map((i) => [i.foodId, i.foodVersionId]));
    const bByFood = new Map(b.map((i) => [i.foodId, i.foodVersionId]));
    const added = [...bByFood.keys()].filter((foodId) => !aByFood.has(foodId));
    const removed = [...aByFood.keys()].filter((foodId) => !bByFood.has(foodId));
    const changed = [...bByFood.entries()]
      .filter(([foodId, versionId]) => aByFood.has(foodId) && aByFood.get(foodId) !== versionId)
      .map(([foodId]) => foodId);
    const unchanged = b.length - added.length - changed.length;
    return { added, removed, changed, unchanged };
  }

  /**
   * Atomically activate a candidate (or previously published) release.
   * Advisory lock serializes concurrent publishes; the partial unique index on
   * is_active is the hard backstop.
   */
  async publish(releaseId: string): Promise<DatasetRelease> {
    const release = await this.prisma.datasetRelease.findUnique({ where: { id: releaseId } });
    if (!release) throw new ReleaseError("release.not_found", "release not found");
    if (!["candidate", "published", "rolled_back"].includes(release.status)) {
      throw new ReleaseError("release.not_publishable", `cannot publish a ${release.status} release`);
    }
    const root = this.prisma as typeof defaultPrisma;
    await root.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dataset_release_publish'))`;
        await tx.$executeRaw`UPDATE food_versions SET is_in_active_release = false WHERE is_in_active_release`;
        await tx.$executeRaw`
          UPDATE food_versions SET is_in_active_release = true
          WHERE id IN (SELECT food_version_id FROM release_items WHERE release_id = ${releaseId}::uuid)`;
        await tx.datasetRelease.updateMany({ where: { isActive: true }, data: { isActive: false } });
        await tx.datasetRelease.update({
          where: { id: releaseId },
          data: { isActive: true, status: "published", publishedAt: release.publishedAt ?? new Date() },
        });
      },
      { timeout: 60_000 },
    );
    return (await this.prisma.datasetRelease.findUnique({ where: { id: releaseId } }))!;
  }

  /** Roll back = republish a prior release and mark the bad one rolled_back. */
  async rollbackTo(previousReleaseId: string): Promise<DatasetRelease> {
    const current = await this.prisma.datasetRelease.findFirst({ where: { isActive: true } });
    const republished = await this.publish(previousReleaseId);
    if (current && current.id !== previousReleaseId) {
      await this.prisma.datasetRelease.update({
        where: { id: current.id },
        data: { status: "rolled_back", rolledBackAt: new Date() },
      });
    }
    return republished;
  }

  async archive(releaseId: string): Promise<DatasetRelease> {
    const release = await this.prisma.datasetRelease.findUnique({ where: { id: releaseId } });
    if (!release) throw new ReleaseError("release.not_found", "release not found");
    if (release.isActive) {
      throw new ReleaseError("release.not_publishable", "cannot archive the active release");
    }
    return this.prisma.datasetRelease.update({ where: { id: releaseId }, data: { status: "archived" } });
  }
}
