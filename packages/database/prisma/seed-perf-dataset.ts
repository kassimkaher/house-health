/**
 * Performance-test-only bulk seed. Populates `foods` + `food_versions` +
 * one active `dataset_release` directly (bypassing the editorial import
 * pipeline, which is already correctness-tested by
 * packages/pipeline/test/pipeline.integration.spec.ts) so we can measure
 * search/detail query performance at realistic dataset volume without
 * waiting on ~50k slow per-row ReleaseService.buildCandidate() calls.
 *
 * Run: DATASET_SIZE=50000 pnpm --filter @hh/database exec tsx prisma/seed-perf-dataset.ts
 * Idempotent-ish: wipes previously seeded perf rows (slug LIKE 'perf-%')
 * before inserting, so it's safe to re-run.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/client";

const DATASET_SIZE = Number(process.env.DATASET_SIZE ?? 50_000);
const BATCH_SIZE = 2000;

const FOOD_TYPES = ["generic_food", "branded_product", "prepared_dish"] as const;
const PREP_STATES = ["raw", "cooked", "baked", "grilled", "fried", "steamed", "canned", "dried", "other"] as const;
const CATEGORY_SLUGS = [
  "bread", "rice-pasta", "breakfast-cereals", "milk", "cheese", "yogurt",
  "beef-lamb", "chicken", "fish-seafood", "eggs", "vegetables", "fruits",
  "legumes", "nuts-seeds", "oils-fats", "beverages", "sweets-desserts",
  "iraqi-dishes", "fast-food", "snacks",
];

// Curated "anchor" foods with real Iraqi-dialect aliases, so tiered ranking
// (exact/prefix/full-text/trigram) has genuine, known-answer targets to
// query against — the bulk filler below exists purely for index/volume
// realism, not for assertions.
const ANCHORS: Array<{
  nameAr: string; nameEn: string; aliases: string[]; category: string; kcal: number;
}> = [
  { nameAr: "رز بسمتي", nameEn: "Basmati rice", aliases: ["timman", "تمن", "روز بسمتي"], category: "rice-pasta", kcal: 130 },
  { nameAr: "دجاج مشوي", nameEn: "Grilled chicken", aliases: ["jaj mashwi", "جاج مشوي"], category: "chicken", kcal: 165 },
  { nameAr: "خبز صمون", nameEn: "Samoon bread", aliases: ["samoon", "صمون"], category: "bread", kcal: 275 },
  { nameAr: "شوربة عدس", nameEn: "Lentil soup", aliases: ["shorbat adas", "شوربة العدس"], category: "iraqi-dishes", kcal: 116 },
  { nameAr: "لبن زبادي", nameEn: "Yogurt", aliases: ["laban", "لبن"], category: "yogurt", kcal: 61 },
  { nameAr: "تفاح أحمر", nameEn: "Red apple", aliases: ["tuffah", "تفاح"], category: "fruits", kcal: 52 },
  { nameAr: "جزر", nameEn: "Carrot", aliases: ["jazar", "جزره"], category: "vegetables", kcal: 41 },
  { nameAr: "حمص", nameEn: "Chickpeas", aliases: ["hummus", "حمّص"], category: "legumes", kcal: 164 },
  { nameAr: "قيمر", nameEn: "Iraqi clotted cream", aliases: ["gaymar", "قيمر عراقي"], category: "dairy", kcal: 300 },
  { nameAr: "مسكوف", nameEn: "Grilled carp (masgouf)", aliases: ["masgouf", "مسكوف عراقي"], category: "fish-seafood", kcal: 206 },
];

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}

function nutrientsFor(kcalBase: number, i: number): Record<string, number> {
  const jitter = (i % 40) - 20;
  return {
    energy_kcal: Math.max(10, kcalBase + jitter),
    energy_kj: Math.max(40, (kcalBase + jitter) * 4.184),
    protein_g: Number((2 + (i % 20)).toFixed(1)),
    carbs_g: Number((5 + (i % 40)).toFixed(1)),
    fat_g: Number((1 + (i % 15)).toFixed(1)),
    sat_fat_g: Number((0.5 + (i % 5)).toFixed(1)),
    fiber_g: Number((0.5 + (i % 8)).toFixed(1)),
    sugars_g: Number((0.5 + (i % 12)).toFixed(1)),
    sodium_mg: 5 + (i % 400),
    cholesterol_mg: i % 60,
  };
}

async function main(): Promise<void> {
  const start = Date.now();
  console.warn(`Seeding ${DATASET_SIZE} perf-test foods...`);

  await prisma.$executeRawUnsafe(
    `DELETE FROM release_items WHERE release_id IN (SELECT id FROM dataset_releases WHERE version = 'perf-test')`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM food_versions WHERE food_id IN (SELECT id FROM foods WHERE slug LIKE 'perf-%')`);
  await prisma.$executeRawUnsafe(`DELETE FROM dataset_releases WHERE version = 'perf-test'`);
  await prisma.$executeRawUnsafe(`DELETE FROM foods WHERE slug LIKE 'perf-%'`);
  // The partial unique index on (is_active) WHERE is_active allows only one
  // active release at a time — deactivate whatever's currently active (if
  // anything) before we activate 'perf-test' below.
  await prisma.$executeRawUnsafe(`UPDATE dataset_releases SET is_active = false WHERE is_active`);

  const releaseId = randomUUID();
  const owner = await prisma.user.findFirst();
  if (!owner) {
    throw new Error("no user found to own the release — run the base seed with SEED_DEV_ACCOUNTS=1 first");
  }

  const total = ANCHORS.length + DATASET_SIZE;
  // release_items rows below FK-reference this release, so it must exist
  // first; food_count et al are filled with the final total up front since
  // we already know it (fixed dataset size, not incrementally discovered).
  await prisma.$executeRawUnsafe(
    `INSERT INTO dataset_releases (id, version, status, is_active, owner_id, food_count, added_count, changed_count, removed_count, checksum, published_at, created_at)
     VALUES ($1::uuid, 'perf-test', 'published', true, $2::uuid, $3, $3, 0, 0, $4, now(), now())`,
    releaseId, owner.id, total, "0".repeat(64),
  );

  let inserted = 0;

  for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
    const foodRows: string[] = [];
    const foodParams: unknown[] = [];
    const versionRows: string[] = [];
    const versionParams: unknown[] = [];
    const itemRows: string[] = [];
    const itemParams: unknown[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const foodId = randomUUID();
      const versionId = randomUUID();
      const isAnchor = i < ANCHORS.length;
      const anchor = isAnchor ? ANCHORS[i] : undefined;
      const nameAr = anchor ? anchor.nameAr : `${pick(["أرز", "دجاج", "خبز", "حليب", "فاكهة", "خضار", "لحم", "جبن"], i)} ${i}`;
      const nameEn = anchor ? anchor.nameEn : `Food item ${i}`;
      const slug = anchor ? `perf-anchor-${i}` : `perf-food-${i}`;
      const category = anchor ? anchor.category : pick(CATEGORY_SLUGS, i);
      const foodType = pick(FOOD_TYPES, i);
      const prepState = pick(PREP_STATES, i);
      const kcalBase = anchor ? anchor.kcal : 50 + (i % 400);
      const nutrients = nutrientsFor(kcalBase, i);
      const aliasesDisplay = anchor
        ? anchor.aliases.map((a) => ({ alias: a, kind: "iraqi_dialect", locale: "ar-IQ" }))
        : [];
      const portions = [{ labelAr: "100 جم", labelEn: "100 g", grams: 100, source: "estimated", locale: null, isDefault: true }];

      const foodParamBase = foodParams.length;
      foodRows.push(
        `($${foodParamBase + 1}::uuid, $${foodParamBase + 2}, $${foodParamBase + 3}::"FoodType", $${foodParamBase + 4}, $${foodParamBase + 5}, $${foodParamBase + 6}::"PreparationState", 'verified', 'published', now(), now())`,
      );
      foodParams.push(foodId, slug, foodType, nameAr, nameEn, prepState);

      // 13 fixed placeholders ($1..$13) map 1:1 to the 13 params pushed
      // below; alias placeholders for the aliases_norm ARRAY[...] literal
      // start at $14 since they're appended after the fixed params.
      const versionParamBase = versionParams.length;
      const aliasPlaceholders = anchor
        ? anchor.aliases.map((_, k) => `normalize_arabic($${versionParamBase + 14 + k})`)
        : [];
      versionRows.push(
        `($${versionParamBase + 1}::uuid, $${versionParamBase + 2}::uuid, 1, $${versionParamBase + 3}, $${versionParamBase + 4}, ` +
          `$${versionParamBase + 5}::"FoodType", $${versionParamBase + 6}, $${versionParamBase + 7}, $${versionParamBase + 8}::"PreparationState", ` +
          `ARRAY[${aliasPlaceholders.join(",")}]::text[], $${versionParamBase + 9}::jsonb, $${versionParamBase + 10}, ` +
          `$${versionParamBase + 11}::jsonb, $${versionParamBase + 12}::jsonb, $${versionParamBase + 13}::numeric, true, now())`,
      );
      versionParams.push(
        versionId, foodId, `perf-seed-${i}`, slug, foodType, nameAr, nameEn, prepState,
        JSON.stringify(aliasesDisplay), category, JSON.stringify(nutrients), JSON.stringify(portions), "0.60",
        ...(anchor ? anchor.aliases : []),
      );

      const itemParamBase = itemParams.length;
      itemRows.push(`($${itemParamBase + 1}::uuid, $${itemParamBase + 2}::uuid, $${itemParamBase + 3}::uuid, 'added')`);
      itemParams.push(releaseId, foodId, versionId);
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO foods (id, slug, food_type, name_ar, name_en, preparation_state, review_status, publication_status, created_at, updated_at) VALUES ${foodRows.join(",")}`,
      ...foodParams,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO food_versions
        (id, food_id, version_number, content_checksum, slug, food_type, name_ar, name_en, preparation_state,
         aliases_norm, aliases_display, category_slug, nutrients, portions, data_confidence, is_in_active_release, created_at)
       VALUES ${versionRows.join(",")}`,
      ...versionParams,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO release_items (release_id, food_id, food_version_id, change_kind) VALUES ${itemRows.join(",")}`,
      ...itemParams,
    );

    inserted = batchEnd;
    if (inserted % 10_000 < BATCH_SIZE) {
      console.warn(`  ${inserted}/${total} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.warn(`Seeded ${total} foods (incl. ${ANCHORS.length} search anchors) + active release 'perf-test' in ${elapsed}s`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
