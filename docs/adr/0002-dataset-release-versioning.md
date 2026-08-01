# ADR 0002: Dataset releases via immutable FoodVersion rows + active-release flag

Status: accepted · Date: 2026-08-01

## Context

Food data is imported, reviewed, corrected, and republished continuously.
Requirements: atomic publish, rollback, comparison between releases, stable
historical nutrition (user diaries must never change retroactively), and fast
public search.

## Decision

Three-part model:

1. `foods` (+ nutrients/aliases/portions/barcodes) is the **mutable editorial
   layer**. Public APIs never read it.
2. `food_versions` are **immutable, fully denormalized snapshots** of a food
   (names, normalized search columns, aliases, barcodes, nutrients JSONB,
   portions JSONB). A content checksum lets unchanged foods reuse their
   version across releases — storage grows with change, not with releases.
3. `dataset_releases` + `release_items` pin (food → version). Publishing flips
   `food_versions.is_in_active_release` for the release's members and swaps
   `dataset_releases.is_active` — one transaction guarded by
   `pg_advisory_xact_lock`, with partial unique indexes as a backstop.
   Rollback republishes a prior release the same way.

Public search/detail reads are single-table scans over
`food_versions WHERE is_in_active_release` (all search indexes are partial on
that flag). Diary entries and recipe ingredients snapshot nutrition JSONB
pinned to a `food_version_id`, so dataset updates never rewrite history.

## Alternatives rejected

- Membership tables pointing at live `foods`: post-publish edits would mutate
  the released dataset.
- Full copy-per-release: linear storage/index bloat per release; awkward
  "which releases contained this exact record" queries.

## Consequences

- Release build is the single place that flattens brand/category/aliases into
  the version row.
- The publish flag-flip touches ~N rows; releases are rare and lock-guarded,
  so dead-tuple churn is acceptable (autovacuum tuned on `food_versions`).
