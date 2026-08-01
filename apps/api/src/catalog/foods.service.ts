import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Food, Prisma, ReviewStatus } from "@hh/database";
import {
  ERROR_CODES,
  type AddAliasDto,
  type AddBarcodeDto,
  type CreateFoodDto,
  type ListFoodsQuery,
  type ReviewTransitionDto,
  type SetFoodNutrientsDto,
  type UpdateFoodDto,
  type UpsertPortionDto,
} from "@hh/contracts";
import { AuditService } from "../auth/audit.service";
import { PrismaService } from "../infra/prisma.service";

/**
 * Legal review-state transitions. Editorial flow:
 * imported → normalized → needs_review → verified | rejected; verified drops
 * back to needs_review on substantive edits; anything can be archived; only
 * rejected/archived can be revived into needs_review.
 */
const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  imported: ["normalized", "needs_review", "archived"],
  normalized: ["needs_review", "archived"],
  needs_review: ["verified", "rejected", "archived"],
  verified: ["needs_review", "archived"],
  rejected: ["needs_review", "archived"],
  archived: ["needs_review"],
};

const FOOD_INCLUDE = {
  aliases: true,
  nutrients: { include: { nutrient: true } },
  barcodes: true,
  portions: { orderBy: { sortOrder: "asc" as const } },
  category: true,
  brand: true,
  sourceRecords: { include: { provider: true } },
} satisfies Prisma.FoodInclude;

export type AdminFood = Prisma.FoodGetPayload<{ include: typeof FOOD_INCLUDE }>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "food"
  );
}

@Injectable()
export class FoodsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(query: ListFoodsQuery): Promise<{ items: AdminFood[]; nextCursor: string | null }> {
    const where: Prisma.FoodWhereInput = {
      deletedAt: null,
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.publicationStatus ? { publicationStatus: query.publicationStatus } : {}),
      ...(query.foodType ? { foodType: query.foodType } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
    };
    if (query.q) {
      // Editorial search over normalized names + aliases (trigram-indexed).
      const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT f.id FROM foods f
        LEFT JOIN food_aliases a ON a.food_id = f.id
        WHERE f.deleted_at IS NULL AND (
          f.name_ar_norm % normalize_arabic(${query.q})
          OR f.name_en_norm % normalize_arabic(${query.q})
          OR f.name_ar_norm LIKE normalize_arabic(${query.q}) || '%'
          OR f.name_en_norm LIKE normalize_arabic(${query.q}) || '%'
          OR a.alias_norm % normalize_arabic(${query.q})
        )
        LIMIT 500`;
      where.id = { in: ids.map((r) => r.id) };
    }
    const items = await this.prisma.food.findMany({
      where,
      include: FOOD_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const nextCursor = items.length > query.limit ? (items.pop()?.id ?? null) : null;
    return { items, nextCursor };
  }

  async get(id: string): Promise<AdminFood> {
    const food = await this.prisma.food.findFirst({
      where: { id, deletedAt: null },
      include: FOOD_INCLUDE,
    });
    if (!food) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return food;
  }

  async create(dto: CreateFoodDto, actorId: string): Promise<AdminFood> {
    const slug = await this.uniqueSlug(dto.slug ?? slugify(dto.nameEn));
    if (dto.slug) {
      const taken = await this.prisma.food.findUnique({ where: { slug: dto.slug } });
      if (taken) throw new ConflictException({ code: ERROR_CODES.CATALOG_SLUG_TAKEN });
    }
    const food = await this.prisma.food.create({
      data: {
        slug,
        foodType: dto.foodType,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        descriptionAr: dto.descriptionAr ?? null,
        descriptionEn: dto.descriptionEn ?? null,
        categoryId: dto.categoryId ?? null,
        brandId: dto.brandId ?? null,
        preparationState: dto.preparationState,
        defaultPortionGrams: dto.defaultPortionGrams ?? null,
        densityGPerMl: dto.densityGPerMl ?? null,
        edibleFraction: dto.edibleFraction ?? null,
        marketTags: dto.marketTags,
        dietaryTags: dto.dietaryTags,
        allergenTags: dto.allergenTags,
        dataConfidence: dto.dataConfidence,
        createdById: actorId,
      },
      include: FOOD_INCLUDE,
    });
    await this.auditFood(actorId, "food.create", food.id, null, { slug: food.slug });
    return food;
  }

  /** Optimistic concurrency: caller supplies the expected rowVersion. */
  async update(id: string, expectedVersion: number, dto: UpdateFoodDto, actorId: string): Promise<AdminFood> {
    const before = await this.get(id);
    const result = await this.prisma.food.updateMany({
      where: { id, rowVersion: expectedVersion, deletedAt: null },
      data: {
        ...this.foodData(dto),
        rowVersion: { increment: 1 },
        // Substantive edits send verified foods back to review.
        ...(before.reviewStatus === "verified" ? { reviewStatus: "needs_review" } : {}),
      },
    });
    if (result.count === 0) {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT_VERSION });
    }
    await this.auditFood(actorId, "food.update", id, { rowVersion: expectedVersion }, dto as object);
    return this.get(id);
  }

  async transition(id: string, dto: ReviewTransitionDto, actorId: string): Promise<AdminFood> {
    const food = await this.get(id);
    const allowed = REVIEW_TRANSITIONS[food.reviewStatus] ?? [];
    if (!allowed.includes(dto.to)) {
      throw new UnprocessableEntityException({
        code: ERROR_CODES.CATALOG_INVALID_TRANSITION,
        from: food.reviewStatus,
        to: dto.to,
        allowed,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.food.update({
        where: { id },
        data: {
          reviewStatus: dto.to,
          reviewedById: actorId,
          reviewedAt: new Date(),
          ...(dto.notes !== undefined ? { reviewNotes: dto.notes } : {}),
          // Rejection/archival deprecates the published record.
          ...(dto.to === "rejected" || dto.to === "archived"
            ? { publicationStatus: "deprecated" as const }
            : {}),
        },
      });
      // Freeing barcodes on reject/archive happens atomically with the flip.
      if (dto.to === "rejected" || dto.to === "archived") {
        await tx.barcode.updateMany({ where: { foodId: id, isActive: true }, data: { isActive: false } });
      }
    });
    await this.auditFood(actorId, `food.review.${dto.to}`, id, { from: food.reviewStatus }, { to: dto.to, notes: dto.notes ?? null });
    return this.get(id);
  }

  /** Replace the nutrient set; rebuilds the denormalized per-100g map. */
  async setNutrients(id: string, dto: SetFoodNutrientsDto, actorId: string): Promise<AdminFood> {
    await this.get(id);
    const keys = dto.nutrients.map((n) => n.key);
    const defs = await this.prisma.nutrientDefinition.findMany({ where: { key: { in: keys } } });
    const defByKey = new Map(defs.map((d) => [d.key, d]));
    const unknown = keys.filter((k) => !defByKey.has(k));
    if (unknown.length > 0) {
      throw new UnprocessableEntityException({ code: ERROR_CODES.CATALOG_UNKNOWN_NUTRIENT, keys: unknown });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.foodNutrient.deleteMany({ where: { foodId: id } });
      await tx.foodNutrient.createMany({
        data: dto.nutrients.map((n) => ({
          foodId: id,
          nutrientId: defByKey.get(n.key)!.id,
          valuePer100g: n.valuePer100g,
          originalValue: n.originalValue ?? null,
          originalUnit: n.originalUnit ?? null,
          originalBasis: n.originalBasis ?? null,
          derivation: n.derivation ?? null,
        })),
      });
      const denorm = Object.fromEntries(dto.nutrients.map((n) => [n.key, n.valuePer100g]));
      await tx.food.update({ where: { id }, data: { nutrientsDenorm: denorm } });
    });
    await this.auditFood(actorId, "food.nutrients.set", id, null, { count: dto.nutrients.length });
    return this.get(id);
  }

  async addAlias(id: string, dto: AddAliasDto, actorId: string): Promise<AdminFood> {
    await this.get(id);
    try {
      await this.prisma.foodAlias.create({
        data: { foodId: id, alias: dto.alias, kind: dto.kind, locale: dto.locale ?? null, source: dto.source ?? null },
      });
    } catch (err) {
      // Unique (food_id, alias_norm, kind): the same normalized alias is a no-op.
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
    await this.auditFood(actorId, "food.alias.add", id, null, { alias: dto.alias, kind: dto.kind });
    return this.get(id);
  }

  async removeAlias(foodId: string, aliasId: string, actorId: string): Promise<void> {
    const deleted = await this.prisma.foodAlias.deleteMany({ where: { id: aliasId, foodId } });
    if (deleted.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    await this.auditFood(actorId, "food.alias.remove", foodId, { aliasId }, null);
  }

  async addBarcode(id: string, dto: AddBarcodeDto, actorId: string): Promise<AdminFood> {
    await this.get(id);
    const activeHolder = await this.prisma.barcode.findFirst({
      where: { code: dto.code, isActive: true },
      select: { foodId: true },
    });
    if (activeHolder && activeHolder.foodId !== id) {
      throw new ConflictException({ code: ERROR_CODES.CATALOG_BARCODE_TAKEN, foodId: activeHolder.foodId });
    }
    if (!activeHolder) {
      await this.prisma.barcode.create({
        data: { foodId: id, code: dto.code, type: dto.type, source: dto.source ?? null },
      });
    }
    await this.auditFood(actorId, "food.barcode.add", id, null, { code: dto.code });
    return this.get(id);
  }

  async deactivateBarcode(foodId: string, barcodeId: string, actorId: string): Promise<void> {
    const updated = await this.prisma.barcode.updateMany({
      where: { id: barcodeId, foodId, isActive: true },
      data: { isActive: false },
    });
    if (updated.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    await this.auditFood(actorId, "food.barcode.deactivate", foodId, { barcodeId }, null);
  }

  async addPortion(id: string, dto: UpsertPortionDto, actorId: string): Promise<AdminFood> {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.foodPortion.updateMany({ where: { foodId: id, isDefault: true }, data: { isDefault: false } });
      }
      await tx.foodPortion.create({
        data: {
          foodId: id,
          labelAr: dto.labelAr,
          labelEn: dto.labelEn,
          grams: dto.grams,
          source: dto.source,
          confidence: dto.confidence,
          locale: dto.locale ?? null,
          isDefault: dto.isDefault,
          sortOrder: dto.sortOrder,
          reviewStatus: "needs_review",
        },
      });
    });
    await this.auditFood(actorId, "food.portion.add", id, null, { labelEn: dto.labelEn, grams: dto.grams });
    return this.get(id);
  }

  async removePortion(foodId: string, portionId: string, actorId: string): Promise<void> {
    const deleted = await this.prisma.foodPortion.deleteMany({ where: { id: portionId, foodId } });
    if (deleted.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    await this.auditFood(actorId, "food.portion.remove", foodId, { portionId }, null);
  }

  async softDelete(id: string, actorId: string): Promise<void> {
    const food = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.food.update({
        where: { id },
        data: { deletedAt: new Date(), publicationStatus: "deprecated" },
      });
      await tx.barcode.updateMany({ where: { foodId: id, isActive: true }, data: { isActive: false } });
    });
    await this.auditFood(actorId, "food.delete", id, { slug: food.slug }, null);
  }

  private async auditFood(
    actorId: string,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await this.audit.append({
      actorId,
      action,
      entityType: "food",
      entityId,
      before: before ?? undefined,
      after: after ?? undefined,
    });
  }

  private foodData(dto: CreateFoodDto | UpdateFoodDto): Prisma.FoodUncheckedUpdateInput {
    const entries = Object.entries({
      foodType: dto.foodType,
      nameAr: dto.nameAr,
      nameEn: dto.nameEn,
      descriptionAr: dto.descriptionAr,
      descriptionEn: dto.descriptionEn,
      categoryId: dto.categoryId,
      brandId: dto.brandId,
      preparationState: dto.preparationState,
      defaultPortionGrams: dto.defaultPortionGrams,
      densityGPerMl: dto.densityGPerMl,
      edibleFraction: dto.edibleFraction,
      marketTags: dto.marketTags,
      dietaryTags: dto.dietaryTags,
      allergenTags: dto.allergenTags,
      dataConfidence: dto.dataConfidence,
    }).filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries) as Prisma.FoodUncheckedUpdateInput;
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    for (let i = 2; i < 50; i += 1) {
      const existing = await this.prisma.food.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
      candidate = `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
  }
}

export { FOOD_INCLUDE };
export type { Food };
