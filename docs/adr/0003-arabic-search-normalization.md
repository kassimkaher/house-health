# ADR 0003: Arabic search normalization as a single SQL function

Status: accepted · Date: 2026-08-01

## Context

Arabic-first search must match across orthographic variants (alef forms,
ta marbuta vs ha, alif maqsura vs ya, hamza seats, diacritics, tatweel) and
Iraqi-dialect aliases, plus English and transliterations, with typo tolerance
— using PostgreSQL only.

## Decision

One `IMMUTABLE` SQL function `normalize_arabic(text)` (defined in the initial
migration) is the **only** normalizer in the system:

- Generated columns (`*_norm`, `search_tsv`) on `foods`, `food_aliases`,
  `brands`, `food_versions` use it at write time.
- Query code normalizes the user's term by calling the same function inline.
- Application code NEVER re-implements normalization — app/DB drift would
  silently break the exact-match ranking tier.

Folding policy v1: `أ إ آ ٱ → ا`, `ى → ي`, `ة → ه`, `ؤ ئ → ء`, strip tatweel +
harakat + dagger alif, then `lower(unaccent(...))`. `unaccent` and
`array_to_string` get IMMUTABLE wrappers (documented workaround; dictionary is
pinned).

Ranking tiers: exact normalized match (names/aliases) > prefix (`LIKE`,
`text_pattern_ops` btree) > full-text (`tsvector`, `simple` config — core PG
has no Arabic stemmer) > trigram similarity (`pg_trgm`, threshold 0.25 because
Arabic food words are short). Barcode lookup is a separate exact-match path.

Changing the folding policy requires: a new function name
(`normalize_arabic_v2`), rebuilding generated columns + indexes, and a dataset
release rebuild. Tests pin the policy character-by-character.

## Consequences

- No Elasticsearch to operate; search ships with the database.
- The `simple` FTS config means no Arabic stemming — trigram + alias coverage
  compensates; measured against the p95 targets in phase 15.
