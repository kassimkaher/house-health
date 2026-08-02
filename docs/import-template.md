# Import File Format (CSV / JSON)

The import pipeline (`packages/pipeline/src/import/row-schema.ts`) accepts
CSV (with header row) or JSON (array of row objects) with these columns.
Unknown columns are preserved in provenance (`originalPayload`) but ignored
for mapping — the importer never silently drops data, it just doesn't act on
columns it doesn't recognize.

## Required columns

| Column | Type | Notes |
|---|---|---|
| `external_id` | string | Unique per provider; the primary dedupe key. |
| `name_ar` | string | Canonical Arabic name. |
| `name_en` | string | Canonical English name. |
| `energy_kcal` | number ≥ 0 | Per 100 g. |
| `protein_g` | number ≥ 0 | Per 100 g. |
| `carbs_g` | number ≥ 0 | Per 100 g. |
| `fat_g` | number ≥ 0 | Per 100 g. |

## Optional columns

| Column | Type | Notes |
|---|---|---|
| `food_type` | `generic_food`\|`branded_product`\|`prepared_dish` | Defaults to `generic_food`. |
| `preparation_state` | `raw`\|`cooked`\|`baked`\|`grilled`\|`fried`\|`steamed`\|`canned`\|`dried`\|`other` | Defaults to `other`. |
| `category_slug` | string | Must match an existing `food_categories.slug`, else left unset. |
| `brand_slug` | string | Must match an existing `brands.slug`, else left unset. |
| `barcode` | 6–14 digits | Attached only if not already actively held by another food. |
| `default_portion_grams` | number > 0 | |
| `aliases_iraqi` | `alias1\|alias2` | Pipe-separated Iraqi-dialect aliases. |
| `aliases_en` | `alias1\|alias2` | Pipe-separated English aliases/transliterations. |
| `sat_fat_g`, `fiber_g`, `sugars_g`, `sodium_mg`, `cholesterol_mg` | number ≥ 0 | Per 100 g; omit if unknown — never invented. |
| `portion_label_ar`, `portion_label_en`, `portion_grams` | string, string, number > 0 | All three together define one named portion. |

## Modes

- `create_only` — matched rows (by external ID, active barcode, or
  high-similarity name) are skipped as duplicates; nothing is overwritten.
- `update_existing` — unmatched rows are hard errors (`no_match`); only
  existing foods are touched.
- `upsert` (default) — matched rows update, unmatched rows create.

## Example (CSV)

```csv
external_id,name_ar,name_en,food_type,preparation_state,category_slug,barcode,default_portion_grams,aliases_iraqi,aliases_en,energy_kcal,protein_g,carbs_g,fat_g,sat_fat_g,fiber_g,sugars_g,sodium_mg,cholesterol_mg,portion_label_ar,portion_label_en,portion_grams
IQ-0001,صمون عراقي,Iraqi Samoon,generic_food,baked,bread,,90,صمونة|صمونه حجرية,samoon|samun,270,9,52,1.5,0.3,2.1,1.8,430,0,صمونة واحدة,1 samoon,90
```

See `packages/pipeline/test/fixtures/foods-sample.csv` for a complete
runnable example, including a deliberately invalid row (missing
`energy_kcal`) demonstrating the row-level error report.

## Duplicate detection order

1. `(providerId, external_id)` exact match.
2. Active barcode exact match.
3. Normalized name exact match (`normalize_arabic(name_ar/name_en)`).
4. Trigram similarity ≥ 0.55 on normalized names (flagged as
   `trgm_similarity` match method — review before trusting an auto-update).

Every row's match method and score are recorded in
`import_job_rows.matchMethod` / `matchScore`, visible via
`GET /admin/imports/:id` (row detail) for audit.
