import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ERROR_CODES } from "@hh/contracts";
import {
  GramResolutionError,
  buildNutritionSnapshot,
  resolveGrams,
  type NutritionSnapshot,
} from "@hh/domain";
import { PrismaService } from "../infra/prisma.service";

export interface FoodQuantityInput {
  foodId: string;
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "portion" | "serving";
  portionLabelEn?: string | undefined;
}

/**
 * Builds immutable nutrition snapshots for foods in the ACTIVE release.
 * The sole write-path into snapshot JSONB for food-based items — recipes
 * scale their own stored totals.
 */
@Injectable()
export class SnapshotResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async forFood(input: FoodQuantityInput): Promise<{ snapshot: NutritionSnapshot; grams: number }> {
    const version = await this.prisma.foodVersion.findFirst({
      where: { foodId: input.foodId, isInActiveRelease: true },
    });
    if (!version) {
      throw new UnprocessableEntityException({
        code: ERROR_CODES.FOOD_NOT_AVAILABLE,
        foodId: input.foodId,
      });
    }
    const release = await this.prisma.releaseItem.findFirst({
      where: { foodVersionId: version.id, release: { isActive: true } },
      select: { releaseId: true },
    });

    const portions =
      (version.portions as Array<{ labelEn: string; labelAr: string; grams: number; isDefault: boolean }>) ?? [];
    let resolved: { grams: number; portionLabelAr?: string | undefined; portionLabelEn?: string | undefined };
    try {
      resolved = resolveGrams({
        quantity: input.quantity,
        unit: input.unit,
        portionLabelEn: input.portionLabelEn,
        densityGPerMl: version.densityGPerMl ? Number(version.densityGPerMl) : null,
        defaultPortionGrams: version.defaultPortionGrams ? Number(version.defaultPortionGrams) : null,
        portions,
      });
    } catch (err) {
      if (err instanceof GramResolutionError) {
        throw new UnprocessableEntityException({
          code: ERROR_CODES.FOOD_UNIT_CONVERSION_FAILED,
          reason: err.code,
          message: err.message,
        });
      }
      throw err;
    }

    const snapshot = buildNutritionSnapshot(
      {
        foodId: version.foodId,
        foodVersionId: version.id,
        releaseId: release?.releaseId ?? null,
        nameAr: version.nameAr,
        nameEn: version.nameEn,
        brandName: version.brandName,
        nutrientsPer100g: (version.nutrients as Record<string, number>) ?? {},
      },
      {
        quantity: input.quantity,
        unit: input.unit,
        grams: resolved.grams,
        portionLabelAr: resolved.portionLabelAr,
        portionLabelEn: resolved.portionLabelEn,
      },
      new Date(),
    );
    return { snapshot, grams: resolved.grams };
  }

  /**
   * Rebuild a snapshot after a quantity edit — pinned to the ORIGINAL food
   * version, never the current release (history must stay reproducible).
   */
  async rebuildFromPinned(
    original: NutritionSnapshot,
    newQuantity: number,
  ): Promise<{ snapshot: NutritionSnapshot; grams: number }> {
    if (original.source.foodVersionId) {
      const version = await this.prisma.foodVersion.findUnique({
        where: { id: original.source.foodVersionId },
      });
      if (!version) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
      const gramsPerUnit = original.basis.grams / original.basis.quantity;
      const grams = gramsPerUnit * newQuantity;
      const snapshot = buildNutritionSnapshot(
        {
          foodId: original.source.foodId,
          foodVersionId: version.id,
          releaseId: original.source.releaseId,
          nameAr: original.source.nameAr,
          nameEn: original.source.nameEn,
          brandName: original.source.brandName,
          nutrientsPer100g: (version.nutrients as Record<string, number>) ?? {},
        },
        {
          quantity: newQuantity,
          unit: original.basis.unit,
          grams,
          portionLabelAr: original.basis.portionLabelAr ?? undefined,
          portionLabelEn: original.basis.portionLabelEn ?? undefined,
        },
        new Date(),
      );
      return { snapshot, grams };
    }
    // Recipe-derived snapshot: scale linearly from the stored values.
    const factor = newQuantity / original.basis.quantity;
    const snapshot: NutritionSnapshot = {
      ...original,
      basis: { ...original.basis, quantity: newQuantity, grams: Math.round(original.basis.grams * factor * 1000) / 1000 },
      nutrients: Object.fromEntries(
        Object.entries(original.nutrients).map(([k, v]) => [k, Math.round(v * factor * 1000) / 1000]),
      ),
      source: { ...original.source, computedAt: new Date().toISOString() },
    };
    return { snapshot, grams: snapshot.basis.grams };
  }
}
