# Food Data Schema Specification

Canonical reference for the food dataset model. Source of truth is
`packages/database/prisma/schema.prisma`; this document explains the *why*
behind the shape.

## Two layers: editorial vs. published

| Layer | Tables | Mutable? | Read by |
|---|---|---|---|
| Editorial | `foods`, `food_aliases`, `food_nutrients`, `barcodes`, `food_portions`, `food_categories`, `brands`, `food_source_records` | Yes — this is where admins/reviewers work | Admin APIs only |
| Published | `food_versions` (+ `dataset_releases`, `release_items`) | No — immutable snapshots | Public search/detail, diary/recipe snapshot builder |

A food only becomes publicly visible once: (1) it is `reviewStatus:
verified`, (2) a dataset release is built (snapshotting it into
`food_versions`), and (3) that release is published (flipping
`isInActiveRelease`). See ADR 0002 for the full mechanism and ADR 0003 for
why search only ever reads `food_versions`.

## Food types

`generic_food` (a raw ingredient like rice), `branded_product` (a specific
manufactured item with a brand), `prepared_dish` (a cooked dish as commonly
served), `recipe_template` (a curated recipe treated as a searchable food),
`user_recipe` (a private recipe with its own searchable façade row, via
`Recipe.foodId`).

## Provenance (never lost)

Every food carries `dataConfidence` (0–1) and, when imported, a
`FoodSourceRecord` per (provider, external ID) pair: the raw payload
(`originalPayload` JSONB, nothing discarded), a sha256 checksum
(cheap incremental-import comparison), `transformationVersion` (which
normalizer produced the current row), and reviewer notes. Manually-created
foods (via the admin UI, not import) simply have no source record — that's
expected and fine.

## Nutrients

Normalized to **per 100 g edible portion**, stored per-nutrient in
`food_nutrients` (`valuePer100g`, canonical unit) plus the original
as-received value/unit/basis for audit. The core set (10 nutrients: energy
kcal/kJ, protein, carbs, fat, saturated fat, fiber, sugars, sodium,
cholesterol) is seeded in `nutrient_definitions`; adding a micronutrient is
a new row in that table, no schema migration. `Food.nutrientsDenorm` is a
JSONB cache of the same values, rebuilt on every `food_nutrients` write —
this is what admin list views and the release builder read, avoiding an
N+1 join per food.

## Aliases

Stored as **rows**, not an array column, because search needs per-alias
metadata: `kind` (`iraqi_dialect`, `msa_variant`, `english`,
`transliteration`, `colloquial_other`, `brand_variant`), `locale`, and
`source`. Deduplicated on `(foodId, aliasNorm, kind)` — the normalized form,
so `لبنة`/`لبنه` collapse to one alias per kind.

## Barcodes

Globally unique **among active assignments only** (partial unique index on
`code WHERE is_active`). Rejecting/archiving a food deactivates its
barcodes in the same transaction, freeing the code for reassignment to a
corrected duplicate — see the merge/reject flows in
`docs/admin-operations.md`.

## Portions

Never invented. Each portion (`food_portions`) carries `grams`, `source`
(`provider`/`curated`/`user_submitted`/`inferred`), and `confidence` — the
snapshot/unit-resolution layer (`packages/domain/src/nutrition/snapshot.ts`)
throws a hard `422 food.unit_conversion_failed` rather than guessing when a
requested unit/portion isn't known for a food.

## Categories

A self-referencing tree (`food_categories.parentId`), flattened to a
`categoryPath` string (`"grains/bread"`) at release-build time so search
filters don't need a recursive query.

## Preparation state

`raw`, `cooked`, `baked`, `grilled`, `fried`, `steamed`, `canned`, `dried`,
`other` — a flat enum, not a hierarchy; a food's preparation state is
usually singular and unambiguous once decided.
