import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Recipe } from "@hh/database";
import { ERROR_CODES, type CreateRecipeDto, type UpdateRecipeDto } from "@hh/contracts";
import { scaleNutrients, sumSnapshotNutrients, type NutritionSnapshot } from "@hh/domain";
import { PrismaService } from "../infra/prisma.service";
import { SnapshotResolverService } from "./snapshot-resolver.service";

const RECIPE_INCLUDE = {
  ingredients: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.RecipeInclude;

export type RecipeWithIngredients = Prisma.RecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;

export interface RecipeTotals {
  v: number;
  total: Record<string, number>;
  perServing: Record<string, number>;
  computedAt: string;
}

@Injectable()
export class RecipesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SnapshotResolverService) private readonly snapshots: SnapshotResolverService,
  ) {}

  async list(userId: string, status: "active" | "archived" = "active"): Promise<RecipeWithIngredients[]> {
    return this.prisma.recipe.findMany({
      where: { ownerUserId: userId, status, deletedAt: null },
      include: RECIPE_INCLUDE,
      orderBy: { updatedAt: "desc" },
    });
  }

  async get(userId: string, id: string): Promise<RecipeWithIngredients> {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, ownerUserId: userId, deletedAt: null },
      include: RECIPE_INCLUDE,
    });
    if (!recipe) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return recipe;
  }

  async create(userId: string, dto: CreateRecipeDto): Promise<RecipeWithIngredients> {
    const resolved = await this.resolveIngredients(dto.ingredients);
    const totals = this.computeTotals(resolved.map((r) => r.snapshot), dto.servings);
    const recipe = await this.prisma.recipe.create({
      data: {
        ownerUserId: userId,
        titleAr: dto.titleAr,
        titleEn: dto.titleEn ?? null,
        servings: dto.servings,
        cookedWeightGrams: dto.cookedWeightGrams ?? null,
        ...(dto.instructions ? { instructions: dto.instructions } : {}),
        nutritionTotals: totals as unknown as Prisma.InputJsonValue,
        ingredients: {
          create: resolved.map((r, index) => ({
            foodId: r.input.foodId,
            quantity: r.input.quantity,
            unit: r.input.unit,
            grams: r.grams,
            preparationNote: r.input.preparationNote ?? null,
            nutritionSnapshot: r.snapshot as unknown as Prisma.InputJsonValue,
            sortOrder: index,
          })),
        },
      },
      include: RECIPE_INCLUDE,
    });
    return recipe;
  }

  /** Full update; ingredient list (when provided) is replaced + recomputed. */
  async update(userId: string, id: string, dto: UpdateRecipeDto): Promise<RecipeWithIngredients> {
    const existing = await this.get(userId, id);
    const servings = dto.servings ?? Number(existing.servings);

    let ingredientOps: Prisma.RecipeUpdateInput["ingredients"];
    let totals: RecipeTotals | undefined;
    if (dto.ingredients) {
      const resolved = await this.resolveIngredients(dto.ingredients);
      totals = this.computeTotals(resolved.map((r) => r.snapshot), servings);
      ingredientOps = {
        deleteMany: {},
        create: resolved.map((r, index) => ({
          foodId: r.input.foodId,
          quantity: r.input.quantity,
          unit: r.input.unit,
          grams: r.grams,
          preparationNote: r.input.preparationNote ?? null,
          nutritionSnapshot: r.snapshot as unknown as Prisma.InputJsonValue,
          sortOrder: index,
        })),
      };
    } else if (dto.servings !== undefined) {
      // Servings changed alone: rescale per-serving from stored totals.
      const stored = existing.nutritionTotals as unknown as RecipeTotals | null;
      if (stored) {
        totals = { ...stored, perServing: scaleNutrients(stored.total, 1 / servings), computedAt: new Date().toISOString() };
      }
    }

    await this.prisma.recipe.update({
      where: { id },
      data: {
        ...(dto.titleAr !== undefined ? { titleAr: dto.titleAr } : {}),
        ...(dto.titleEn !== undefined ? { titleEn: dto.titleEn } : {}),
        ...(dto.servings !== undefined ? { servings: dto.servings } : {}),
        ...(dto.cookedWeightGrams !== undefined ? { cookedWeightGrams: dto.cookedWeightGrams } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(totals ? { nutritionTotals: totals as unknown as Prisma.InputJsonValue } : {}),
        ...(ingredientOps ? { ingredients: ingredientOps } : {}),
        rowVersion: { increment: 1 },
      },
    });
    return this.get(userId, id);
  }

  async duplicate(userId: string, id: string): Promise<RecipeWithIngredients> {
    const source = await this.get(userId, id);
    return this.prisma.recipe.create({
      data: {
        ownerUserId: userId,
        titleAr: `${source.titleAr} (نسخة)`,
        titleEn: source.titleEn ? `${source.titleEn} (copy)` : null,
        servings: source.servings,
        cookedWeightGrams: source.cookedWeightGrams,
        ...(source.instructions !== null ? { instructions: source.instructions as Prisma.InputJsonValue } : {}),
        ...(source.nutritionTotals !== null ? { nutritionTotals: source.nutritionTotals as Prisma.InputJsonValue } : {}),
        ingredients: {
          create: source.ingredients.map((ing) => ({
            foodId: ing.foodId,
            quantity: ing.quantity,
            unit: ing.unit,
            grams: ing.grams,
            preparationNote: ing.preparationNote,
            nutritionSnapshot: ing.nutritionSnapshot as Prisma.InputJsonValue,
            sortOrder: ing.sortOrder,
          })),
        },
      },
      include: RECIPE_INCLUDE,
    });
  }

  async setStatus(userId: string, id: string, status: "active" | "archived"): Promise<Recipe> {
    await this.get(userId, id);
    return this.prisma.recipe.update({ where: { id }, data: { status } });
  }

  async softDelete(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    await this.prisma.recipe.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Recalculation preview: what totals WOULD be against the current release.
   * Never writes — historical logs and stored totals stay untouched.
   */
  async recalcPreview(userId: string, id: string): Promise<{
    current: RecipeTotals | null;
    recalculated: RecipeTotals;
    changedIngredients: string[];
  }> {
    const recipe = await this.get(userId, id);
    const resolved = await this.resolveIngredients(
      recipe.ingredients.map((ing) => ({
        foodId: ing.foodId,
        quantity: Number(ing.quantity),
        unit: ing.unit as "g" | "kg" | "ml" | "l" | "portion" | "serving",
        portionLabelEn:
          (ing.nutritionSnapshot as unknown as NutritionSnapshot)?.basis?.portionLabelEn ?? undefined,
      })),
    );
    const recalculated = this.computeTotals(resolved.map((r) => r.snapshot), Number(recipe.servings));
    const changedIngredients = recipe.ingredients
      .filter((ing, i) => {
        const oldSnap = ing.nutritionSnapshot as unknown as NutritionSnapshot;
        const newSnap = resolved[i]?.snapshot;
        return JSON.stringify(oldSnap?.nutrients) !== JSON.stringify(newSnap?.nutrients);
      })
      .map((ing) => ing.foodId);
    return {
      current: (recipe.nutritionTotals as unknown as RecipeTotals) ?? null,
      recalculated,
      changedIngredients,
    };
  }

  private async resolveIngredients(inputs: CreateRecipeDto["ingredients"]) {
    return Promise.all(
      inputs.map(async (input) => {
        const { snapshot, grams } = await this.snapshots.forFood({
          foodId: input.foodId,
          quantity: input.quantity,
          unit: input.unit,
          portionLabelEn: input.portionLabelEn,
        });
        return { input, snapshot, grams };
      }),
    );
  }

  private computeTotals(snapshots: NutritionSnapshot[], servings: number): RecipeTotals {
    const total = sumSnapshotNutrients(snapshots);
    return {
      v: 1,
      total,
      perServing: scaleNutrients(total, 1 / servings),
      computedAt: new Date().toISOString(),
    };
  }
}
