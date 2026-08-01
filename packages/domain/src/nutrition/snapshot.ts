/**
 * Immutable nutrition snapshots — the mechanism that keeps diary history and
 * recipe totals stable across dataset releases. Snapshots are write-once;
 * quantity edits rebuild from the SAME pinned food version, never from the
 * current release. This module is the ONLY place snapshots are built.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const CALC_VERSION = "nutrition-calc@1";

/** Core nutrient keys every snapshot carries (missing = unknown, omitted). */
export const CORE_NUTRIENT_KEYS = [
  "energy_kcal",
  "energy_kj",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sat_fat_g",
  "fiber_g",
  "sugars_g",
  "sodium_mg",
  "cholesterol_mg",
] as const;

export interface SnapshotSource {
  foodId: string;
  foodVersionId: string | null; // null for recipe-derived snapshots
  releaseId: string | null;
  nameAr: string;
  nameEn: string;
  brandName: string | null;
  /** Per-100g canonical values. */
  nutrientsPer100g: Record<string, number>;
}

export interface SnapshotBasis {
  quantity: number;
  unit: string; // "g" | "ml" | "portion" | "serving"
  grams: number;
  portionLabelAr?: string | undefined;
  portionLabelEn?: string | undefined;
}

export interface NutritionSnapshot {
  v: number;
  basis: {
    quantity: number;
    unit: string;
    grams: number;
    portionLabelAr: string | null;
    portionLabelEn: string | null;
  };
  source: {
    foodId: string;
    foodVersionId: string | null;
    releaseId: string | null;
    nameAr: string;
    nameEn: string;
    brandName: string | null;
    computedAt: string;
    calcVersion: string;
  };
  /** Values ALREADY SCALED to the logged quantity — consumers never do math. */
  nutrients: Record<string, number>;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildNutritionSnapshot(
  source: SnapshotSource,
  basis: SnapshotBasis,
  computedAt: Date,
): NutritionSnapshot {
  if (!(basis.grams > 0)) {
    throw new Error("snapshot basis.grams must be positive");
  }
  const factor = basis.grams / 100;
  const nutrients: Record<string, number> = {};
  for (const [key, per100] of Object.entries(source.nutrientsPer100g)) {
    if (Number.isFinite(per100)) nutrients[key] = round3(per100 * factor);
  }
  return {
    v: SNAPSHOT_SCHEMA_VERSION,
    basis: {
      quantity: basis.quantity,
      unit: basis.unit,
      grams: round3(basis.grams),
      portionLabelAr: basis.portionLabelAr ?? null,
      portionLabelEn: basis.portionLabelEn ?? null,
    },
    source: {
      foodId: source.foodId,
      foodVersionId: source.foodVersionId,
      releaseId: source.releaseId,
      nameAr: source.nameAr,
      nameEn: source.nameEn,
      brandName: source.brandName,
      computedAt: computedAt.toISOString(),
      calcVersion: CALC_VERSION,
    },
    nutrients,
  };
}

/** Sum many snapshots' nutrient maps (daily totals, recipe totals). */
export function sumSnapshotNutrients(
  snapshots: ReadonlyArray<Pick<NutritionSnapshot, "nutrients">>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.nutrients)) {
      totals[key] = round3((totals[key] ?? 0) + value);
    }
  }
  return totals;
}

/** Scale a nutrient map by a factor (per-serving from totals). */
export function scaleNutrients(nutrients: Record<string, number>, factor: number): Record<string, number> {
  return Object.fromEntries(Object.entries(nutrients).map(([k, v]) => [k, round3(v * factor)]));
}

// --- Unit → gram resolution ------------------------------------------------

export interface GramResolutionInput {
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "portion" | "serving";
  portionLabelEn?: string | undefined;
  densityGPerMl?: number | null | undefined;
  defaultPortionGrams?: number | null | undefined;
  portions?: ReadonlyArray<{ labelEn: string; labelAr: string; grams: number; isDefault: boolean }> | undefined;
}

export class GramResolutionError extends Error {
  constructor(
    public readonly code: "density_unknown" | "portion_unknown" | "invalid_quantity",
    message: string,
  ) {
    super(message);
    this.name = "GramResolutionError";
  }
}

/**
 * Resolve a user-facing quantity to grams. NEVER invents conversions: ml
 * without density and unknown portion labels are hard errors surfaced to the
 * client, per spec.
 */
export function resolveGrams(input: GramResolutionInput): {
  grams: number;
  portionLabelAr?: string | undefined;
  portionLabelEn?: string | undefined;
} {
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
    throw new GramResolutionError("invalid_quantity", "quantity must be a positive number");
  }
  switch (input.unit) {
    case "g":
      return { grams: input.quantity };
    case "kg":
      return { grams: input.quantity * 1000 };
    case "ml":
    case "l": {
      const ml = input.unit === "l" ? input.quantity * 1000 : input.quantity;
      if (!input.densityGPerMl || input.densityGPerMl <= 0) {
        throw new GramResolutionError(
          "density_unknown",
          "volume units need a known density for this food",
        );
      }
      return { grams: ml * input.densityGPerMl };
    }
    case "portion":
    case "serving": {
      const portions = input.portions ?? [];
      const portion = input.portionLabelEn
        ? portions.find((p) => p.labelEn === input.portionLabelEn)
        : (portions.find((p) => p.isDefault) ?? portions[0]);
      if (portion) {
        return {
          grams: input.quantity * portion.grams,
          portionLabelAr: portion.labelAr,
          portionLabelEn: portion.labelEn,
        };
      }
      if (input.defaultPortionGrams && input.defaultPortionGrams > 0) {
        return { grams: input.quantity * input.defaultPortionGrams };
      }
      throw new GramResolutionError(
        "portion_unknown",
        "no gram weight is known for the requested portion",
      );
    }
  }
}
