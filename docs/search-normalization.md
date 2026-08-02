# Arabic Search Normalization Rules

Implementation: `normalize_arabic(text)`, a single `IMMUTABLE` PostgreSQL SQL
function defined in `packages/database/prisma/migrations/20260801005333_init/migration.sql`
(hand-written section — see ADR 0003). It is the **only** normalizer in the
system: generated columns compute it at write time, and search queries call
the identical function on the user's search term. There is no separate
application-layer normalizer to drift out of sync.

## Folding policy (version 1)

Applied in this order:

1. **Alef unification** — `أ`, `إ`, `آ`, `ٱ` → `ا`. Iraqi/MSA text mixes
   hamza-seated alef forms inconsistently; users searching "اكل" should match
   "أكل".
2. **Alif maqsura → ya** — `ى` → `ي`. Common typing variance, especially in
   dialectal spelling.
3. **Ta marbuta → ha** — `ة` → `ه`. Critical for Iraqi dialect matching —
   e.g. لبنة/لبنه (yogurt drink) are written both ways colloquially.
4. **Hamza-seat folding** — `ؤ`, `ئ` → `ء`. Hamza placement is the single
   most common Arabic typo class; folding to the bare hamza catches it.
5. **Tatweel removal** — the elongation character `ـ` is stripped entirely
   (it carries no phonetic meaning, only typographic stretching).
6. **Diacritic (harakat) removal** — the Unicode range `ً`–`ْ`
   (fatha, damma, kasra, sukun, tanwin, shadda) plus the dagger alif
   `ٰ` are stripped. Most user input and most dataset sources omit
   diacritics inconsistently; normalizing them out avoids false negatives.
7. **Latin/transliteration handling** — `lower(unaccent(...))` wraps the
   whole result, so English names and transliterations ("Samoon" / "samoon")
   normalize case-insensitively, and accented Latin characters (from some
   transliteration schemes) fold to their base form.

`unaccent()` is technically `STABLE`, not `IMMUTABLE`, in PostgreSQL — it is
wrapped in a locally-defined `IMMUTABLE` function
(`immutable_unaccent`) with the dictionary pinned, which is the standard,
documented workaround for using it inside generated columns.

## Where it's applied

- **Generated columns** (`GENERATED ALWAYS ... STORED`, computed by
  PostgreSQL, never written by application code): `foods.name_ar_norm`,
  `foods.name_en_norm`, `food_aliases.alias_norm`, `brands.name_norm`,
  `food_versions.name_ar_norm`, `food_versions.name_en_norm`,
  `food_versions.brand_name_norm`, and the composite `search_tsv` tsvector.
- **Query time**: `normalize_arabic($searchTerm)` in the search CTE (see
  `apps/api/src/foods/food-search.repository.ts`) and in the import
  pipeline's duplicate-detection matching.

## Ranking tiers (highest first)

1. **Exact** — normalized term equals a normalized name or alias.
2. **Prefix** — normalized term is a left-anchored prefix
   (`LIKE term || '%'`, indexed via `text_pattern_ops` btree).
3. **Full-text** — `search_tsv @@ plainto_tsquery('simple', term)`. The
   `simple` PostgreSQL text-search config is used deliberately — core
   PostgreSQL ships no Arabic stemmer, so `simple` (token match, no
   stemming) avoids false-positive stemming artifacts; trigram fuzziness
   (tier 4) compensates for morphological variation instead.
4. **Trigram similarity** — `pg_trgm`, `%` operator, GIN-indexed.
   `pg_trgm.similarity_threshold` is set to **0.25** per search session
   (not the PostgreSQL default of 0.3) because Arabic food names are often
   short (2–4 characters after normalization), and the default threshold
   misses common single-letter typos on short words.

Barcode search is a separate, non-tiered exact-match path
(`barcodes @> ARRAY[code]`) — it never mixes into the text-ranking CTE.

## Changing the policy

Any change to the folding rules requires:

1. A new function (`normalize_arabic_v2`), never editing `normalize_arabic`
   in place — existing generated columns and indexes depend on immutability
   guarantees tied to the function's current behavior.
2. Rebuilding every generated column that calls it (`ALTER TABLE ... ALTER
   COLUMN ... DROP/ADD` with the new expression), which reindexes.
3. Rebuilding the active dataset release, since `food_versions.*_norm`
   columns are also generated from the food snapshot at release-build time.
4. Updating the character-by-character policy tests in
   `apps/api/test/search.integration.spec.ts` and this document.

## Test coverage

`apps/api/test/search.integration.spec.ts` exercises: exact Arabic canonical
match, Iraqi-dialect alias match through the ta-marbuta/ha fold, English
case-insensitive match, prefix ranking, trigram typo tolerance, category/type
filters, exact barcode lookup (hit, miss, and malformed-code rejection),
full detail retrieval, and that unpublished/unreleased foods never appear in
public search results.
