# Entity Relationship Diagram

Summary-level ERD of the Health House schema. The authoritative definition is
`packages/database/prisma/schema.prisma` plus the hand-written SQL in
`packages/database/prisma/migrations/*/migration.sql` (generated columns,
partial indexes, `normalize_arabic()`).

## Identity & profile

```mermaid
erDiagram
    users ||--o{ auth_identities : "OIDC links"
    users ||--o{ sessions : "devices"
    sessions ||--o{ refresh_tokens : "rotation chain"
    users ||--o{ auth_action_tokens : "verify/reset"
    users ||--|| user_profiles : has
    users ||--o{ weight_entries : logs
    users ||--o{ calculation_snapshots : "immutable calc results"
    calculation_policies ||--o{ calculation_snapshots : "versioned config"
```

## Food catalog (editorial layer, mutable)

```mermaid
erDiagram
    food_categories ||--o{ food_categories : subcategories
    food_categories ||--o{ foods : categorizes
    brands ||--o{ foods : brands
    foods ||--o{ food_aliases : "search aliases (dialect/translit)"
    foods ||--o{ food_nutrients : "per-100g values"
    nutrient_definitions ||--o{ food_nutrients : defines
    foods ||--o{ barcodes : "active-scoped unique"
    foods ||--o{ food_portions : "gram-verified portions"
    foods ||--o{ food_source_records : provenance
    data_providers ||--o{ food_source_records : "license registry"
    data_providers ||--o{ import_jobs : sources
    import_jobs ||--o{ import_job_rows : "row status + errors"
```

## Releases (immutable published layer)

```mermaid
erDiagram
    foods ||--o{ food_versions : "checksummed snapshots"
    dataset_releases ||--o{ release_items : membership
    food_versions ||--o{ release_items : "pinned version"
```

The public API reads only `food_versions WHERE is_in_active_release` — a flat,
denormalized, search-indexed table. Publish/rollback flips that flag in one
advisory-locked transaction.

## Consumption

```mermaid
erDiagram
    users ||--o{ recipes : owns
    recipes ||--o{ recipe_ingredients : "snapshotted ingredients"
    users ||--o{ meal_groups : owns
    meal_groups ||--o{ meal_group_items : contains
    users ||--o{ diary_entries : "dated log, immutable snapshots"
    users ||--o{ user_shortcuts : "favorites/pins"
```

`recipe_ingredients.nutrition_snapshot` and `diary_entries.nutrition_snapshot`
are write-once JSONB pinned to a `food_version_id` — dataset updates never
change history.

## Reminders, audit, operations

```mermaid
erDiagram
    users ||--o{ reminders : schedules
    reminders ||--o{ reminder_deliveries : "idempotent delivery log"
    users ||--o{ push_tokens : registers
```

Standalone tables: `audit_log` (append-only, trigger-enforced),
`outbox_events`, `idempotency_keys`, `media_assets`, `search_query_logs`.

## Cross-cutting conventions

- UUID PKs via `gen_random_uuid()`; `Decimal` for all nutrient/weight values.
- Soft delete (`deleted_at`) only where recovery/audit is required: users,
  foods, recipes, meal groups, diary entries, reminders.
- Optimistic concurrency (`row_version`) on admin-edited catalog tables.
- Normalized shadow columns (`*_norm`) are `GENERATED ALWAYS` from
  `normalize_arabic()` — never written by application code.
