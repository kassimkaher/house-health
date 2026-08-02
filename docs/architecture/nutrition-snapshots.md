# Nutrition Snapshot Shape

Referenced from `docs/food-schema-spec.md` and `docs/architecture/erd.md`.
Implementation: `packages/domain/src/nutrition/snapshot.ts`
(`buildNutritionSnapshot`, `sumSnapshotNutrients`, `scaleNutrients`,
`resolveGrams`). This is the **only** code path allowed to write to
`diary_entries.nutritionSnapshot` or `recipe_ingredients.nutritionSnapshot`.

## Shape

```json
{
  "v": 1,
  "basis": {
    "quantity": 1,
    "unit": "portion",
    "grams": 90,
    "portionLabelAr": "صمونة واحدة",
    "portionLabelEn": "1 samoon"
  },
  "source": {
    "foodId": "a7e2...",
    "foodVersionId": "f9b1...",
    "releaseId": "d40a...",
    "nameAr": "صمون عراقي",
    "nameEn": "Iraqi samoon",
    "brandName": null,
    "computedAt": "2026-08-01T10:42:00.000Z",
    "calcVersion": "nutrition-calc@1"
  },
  "nutrients": {
    "energy_kcal": 243,
    "protein_g": 8.1,
    "carbs_g": 46.8
  }
}
```

## Rules

1. **Values are already scaled** to the logged quantity — `nutrients` is
   never a per-100g map. Consumers (diary day summaries, recipe totals) sum
   or scale these numbers directly; they never re-fetch a food's current
   nutrients to compute a total.
2. **`foodVersionId` is pinned at creation.** Editing a diary entry's
   quantity later rebuilds the snapshot by reading nutrients from that exact
   `food_versions` row (`SnapshotResolverService.rebuildFromPinned`), never
   from whatever the active release currently says. This is what makes the
   "historical diary nutrition unchanged after a dataset update" guarantee
   hold — proven by an integration test
   (`apps/api/test/consumption.integration.spec.ts`, the `GATE:` test).
3. **`source` embeds display names.** Even if the underlying food is later
   archived or merged away, historical entries still render a name — they
   don't need a live join to a food row that might not exist in the future.
4. **Recipe-derived snapshots have `foodVersionId: null`.** A diary entry
   logged from a recipe serving snapshots the recipe's *stored* per-serving
   totals (themselves built from ingredient snapshots at recipe save time),
   scaled by servings count. Quantity edits on a recipe-derived entry scale
   linearly rather than re-resolving a food version (there isn't one to
   re-resolve — see `SnapshotResolverService.rebuildFromPinned`'s branch on
   `foodVersionId === null`).
5. **`v` gates future shape migrations.** A schema change to this JSON shape
   bumps `SNAPSHOT_SCHEMA_VERSION`; readers should treat unknown/older
   versions defensively (in practice, all fields used today are additive-only
   so no migration has been needed yet).

## Gram resolution — the "never invent a conversion" rule

`resolveGrams()` converts a user-facing `{quantity, unit}` to grams:

- `g`/`kg` — direct arithmetic, always succeeds.
- `ml`/`l` — requires the food's `densityGPerMl`; throws
  `GramResolutionError("density_unknown")` if absent. **No default density is
  ever assumed.**
- `portion`/`serving` — looks up a matching `FoodPortion` (by label, or the
  food's default portion) with a known gram weight; falls back to
  `defaultPortionGrams` if no portion list exists; throws
  `GramResolutionError("portion_unknown")` if neither is available.

The API surfaces these as `422 food.unit_conversion_failed` with a `reason`
field — client UIs should prompt the user for a different unit rather than
silently guessing, matching the platform-wide principle that a missing
conversion is a user-visible error, not a fabricated number.
