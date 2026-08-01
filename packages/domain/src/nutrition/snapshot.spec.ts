import {
  GramResolutionError,
  buildNutritionSnapshot,
  resolveGrams,
  scaleNutrients,
  sumSnapshotNutrients,
} from "./snapshot";

const SOURCE = {
  foodId: "f-1",
  foodVersionId: "fv-1",
  releaseId: "r-1",
  nameAr: "صمون",
  nameEn: "Samoon",
  brandName: null,
  nutrientsPer100g: { energy_kcal: 270, protein_g: 9, carbs_g: 52 },
};

const NOW = new Date("2026-08-01T10:00:00Z");

describe("buildNutritionSnapshot", () => {
  it("scales per-100g values to the logged grams", () => {
    const snap = buildNutritionSnapshot(SOURCE, { quantity: 1, unit: "portion", grams: 90 }, NOW);
    expect(snap.nutrients).toEqual({ energy_kcal: 243, protein_g: 8.1, carbs_g: 46.8 });
    expect(snap.basis.grams).toBe(90);
    expect(snap.source.foodVersionId).toBe("fv-1");
    expect(snap.v).toBe(1);
  });

  it("rejects non-positive grams", () => {
    expect(() => buildNutritionSnapshot(SOURCE, { quantity: 1, unit: "g", grams: 0 }, NOW)).toThrow();
  });

  it("is deterministic given the same computedAt", () => {
    const a = buildNutritionSnapshot(SOURCE, { quantity: 2, unit: "g", grams: 200 }, NOW);
    const b = buildNutritionSnapshot(SOURCE, { quantity: 2, unit: "g", grams: 200 }, NOW);
    expect(a).toEqual(b);
  });
});

describe("sumSnapshotNutrients / scaleNutrients", () => {
  it("sums across snapshots and scales for per-serving", () => {
    const a = buildNutritionSnapshot(SOURCE, { quantity: 1, unit: "g", grams: 100 }, NOW);
    const b = buildNutritionSnapshot(SOURCE, { quantity: 1, unit: "g", grams: 50 }, NOW);
    const total = sumSnapshotNutrients([a, b]);
    expect(total.energy_kcal).toBe(405);
    expect(scaleNutrients(total, 1 / 3).energy_kcal).toBe(135);
  });
});

describe("resolveGrams", () => {
  const portions = [
    { labelEn: "1 samoon", labelAr: "صمونة واحدة", grams: 90, isDefault: true },
    { labelEn: "half", labelAr: "نصف", grams: 45, isDefault: false },
  ];

  it("passes grams and kilograms through", () => {
    expect(resolveGrams({ quantity: 150, unit: "g" }).grams).toBe(150);
    expect(resolveGrams({ quantity: 1.5, unit: "kg" }).grams).toBe(1500);
  });

  it("converts volume only when density is known", () => {
    expect(resolveGrams({ quantity: 200, unit: "ml", densityGPerMl: 1.03 }).grams).toBeCloseTo(206);
    expect(() => resolveGrams({ quantity: 200, unit: "ml" })).toThrow(GramResolutionError);
    expect(() => resolveGrams({ quantity: 1, unit: "l", densityGPerMl: 0 })).toThrow(/density/);
  });

  it("resolves portions by label, default flag, and multiplies by quantity", () => {
    expect(resolveGrams({ quantity: 2, unit: "portion", portionLabelEn: "half", portions })).toMatchObject({
      grams: 90,
      portionLabelEn: "half",
    });
    expect(resolveGrams({ quantity: 1, unit: "portion", portions }).grams).toBe(90); // default
  });

  it("falls back to defaultPortionGrams, and errors when nothing is known", () => {
    expect(resolveGrams({ quantity: 1, unit: "serving", defaultPortionGrams: 30 }).grams).toBe(30);
    expect(() => resolveGrams({ quantity: 1, unit: "portion" })).toThrow(/portion/);
  });

  it("rejects invalid quantities", () => {
    expect(() => resolveGrams({ quantity: 0, unit: "g" })).toThrow(/quantity/);
    expect(() => resolveGrams({ quantity: Number.NaN, unit: "g" })).toThrow(/quantity/);
  });
});
