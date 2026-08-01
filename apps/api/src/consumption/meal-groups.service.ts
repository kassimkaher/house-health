import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@hh/database";
import { ERROR_CODES, type UpsertMealGroupDto } from "@hh/contracts";
import { scaleNutrients, sumSnapshotNutrients } from "@hh/domain";
import { PrismaService } from "../infra/prisma.service";
import { SnapshotResolverService } from "./snapshot-resolver.service";

const GROUP_INCLUDE = {
  items: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.MealGroupInclude;

export type MealGroupWithItems = Prisma.MealGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

@Injectable()
export class MealGroupsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SnapshotResolverService) private readonly snapshots: SnapshotResolverService,
  ) {}

  list(userId: string, includeDeleted = false): Promise<MealGroupWithItems[]> {
    return this.prisma.mealGroup.findMany({
      where: { userId, ...(includeDeleted ? {} : { deletedAt: null }) },
      include: GROUP_INCLUDE,
      orderBy: [{ isFavorite: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    });
  }

  async get(userId: string, id: string): Promise<MealGroupWithItems> {
    const group = await this.prisma.mealGroup.findFirst({
      where: { id, userId, deletedAt: null },
      include: GROUP_INCLUDE,
    });
    if (!group) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return group;
  }

  async create(userId: string, dto: UpsertMealGroupDto): Promise<MealGroupWithItems> {
    await this.validateItems(userId, dto);
    return this.prisma.mealGroup.create({
      data: {
        userId,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn ?? null,
        mealSlot: dto.mealSlot ?? null,
        isFavorite: dto.isFavorite,
        sortOrder: dto.sortOrder,
        items: {
          create: dto.items.map((item, index) => ({
            itemType: item.itemType,
            foodId: item.foodId ?? null,
            recipeId: item.recipeId ?? null,
            quantity: item.quantity,
            unit: item.unit,
            sortOrder: index,
          })),
        },
      },
      include: GROUP_INCLUDE,
    });
  }

  async update(userId: string, id: string, dto: UpsertMealGroupDto): Promise<MealGroupWithItems> {
    await this.get(userId, id);
    await this.validateItems(userId, dto);
    await this.prisma.mealGroup.update({
      where: { id },
      data: {
        nameAr: dto.nameAr,
        nameEn: dto.nameEn ?? null,
        mealSlot: dto.mealSlot ?? null,
        isFavorite: dto.isFavorite,
        sortOrder: dto.sortOrder,
        items: {
          deleteMany: {},
          create: dto.items.map((item, index) => ({
            itemType: item.itemType,
            foodId: item.foodId ?? null,
            recipeId: item.recipeId ?? null,
            quantity: item.quantity,
            unit: item.unit,
            sortOrder: index,
          })),
        },
      },
    });
    return this.get(userId, id);
  }

  async duplicate(userId: string, id: string): Promise<MealGroupWithItems> {
    const source = await this.get(userId, id);
    return this.prisma.mealGroup.create({
      data: {
        userId,
        nameAr: `${source.nameAr} (نسخة)`,
        nameEn: source.nameEn ? `${source.nameEn} (copy)` : null,
        mealSlot: source.mealSlot,
        isFavorite: false,
        sortOrder: source.sortOrder,
        items: {
          create: source.items.map((item) => ({
            itemType: item.itemType,
            foodId: item.foodId,
            recipeId: item.recipeId,
            quantity: item.quantity,
            unit: item.unit,
            grams: item.grams,
            sortOrder: item.sortOrder,
          })),
        },
      },
      include: GROUP_INCLUDE,
    });
  }

  async archive(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    await this.prisma.mealGroup.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(userId: string, id: string): Promise<MealGroupWithItems> {
    const updated = await this.prisma.mealGroup.updateMany({
      where: { id, userId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (updated.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return this.get(userId, id);
  }

  /** Live totals against the current release (groups are templates, not history). */
  async totals(userId: string, id: string): Promise<Record<string, number>> {
    const group = await this.get(userId, id);
    const parts: Array<{ nutrients: Record<string, number> }> = [];
    for (const item of group.items) {
      if (item.itemType === "food" && item.foodId) {
        const { snapshot } = await this.snapshots.forFood({
          foodId: item.foodId,
          quantity: Number(item.quantity),
          unit: item.unit as "g" | "kg" | "ml" | "l" | "portion" | "serving",
        });
        parts.push(snapshot);
      } else if (item.recipeId) {
        const recipe = await this.prisma.recipe.findFirst({
          where: { id: item.recipeId, ownerUserId: userId, deletedAt: null },
        });
        const totals = recipe?.nutritionTotals as { perServing?: Record<string, number> } | null;
        if (totals?.perServing) {
          parts.push({ nutrients: scaleNutrients(totals.perServing, Number(item.quantity)) });
        }
      }
    }
    return sumSnapshotNutrients(parts);
  }

  private async validateItems(userId: string, dto: UpsertMealGroupDto): Promise<void> {
    for (const item of dto.items) {
      if (item.itemType === "recipe" && item.recipeId) {
        const recipe = await this.prisma.recipe.findFirst({
          where: { id: item.recipeId, ownerUserId: userId, deletedAt: null },
        });
        if (!recipe) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, entity: "recipe" });
      }
    }
  }
}
