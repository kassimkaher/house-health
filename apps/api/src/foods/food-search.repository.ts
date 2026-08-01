import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@hh/database";
import type { FoodSearchCard, SearchFoodsQuery } from "@hh/contracts";
import { PrismaService } from "../infra/prisma.service";

interface RawSearchRow {
  id: string;
  food_id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  brand_name: string | null;
  category_slug: string | null;
  food_type: string;
  preparation_state: string;
  nutrients: Record<string, number>;
  default_portion_grams: string | null;
  image_refs: unknown;
  tier: number;
}

/**
 * Tiered public search over the active release. Ranking:
 *   4 exact normalized match (name/alias) → 3 prefix → 2 full-text → 1 trigram.
 * The WHERE clause is fully index-driven (partial indexes on
 * is_in_active_release); tier scoring runs only over matched candidates.
 * normalize_arabic() is applied IN SQL to both columns and the query term —
 * the application never normalizes (see ADR 0003).
 */
@Injectable()
export class FoodSearchRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(query: SearchFoodsQuery): Promise<{ items: FoodSearchCard[]; hasMore: boolean }> {
    const q = query.q;
    const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
      WITH params AS (
        SELECT normalize_arabic(${q}) AS q,
               plainto_tsquery('simple', normalize_arabic(${q})) AS tsq
      ),
      scored AS (
        SELECT fv.id, fv.food_id, fv.slug, fv.name_ar, fv.name_en, fv.brand_name,
               fv.category_slug, fv.food_type::text AS food_type,
               fv.preparation_state::text AS preparation_state,
               fv.nutrients, fv.default_portion_grams, fv.image_refs,
               fv.data_confidence,
          CASE
            WHEN fv.name_ar_norm = p.q OR fv.name_en_norm = p.q
              OR p.q = ANY(fv.aliases_norm)                                   THEN 4
            WHEN fv.name_ar_norm LIKE p.q || '%' OR fv.name_en_norm LIKE p.q || '%'
              OR EXISTS (SELECT 1 FROM unnest(fv.aliases_norm) a WHERE a LIKE p.q || '%')
                                                                              THEN 3
            WHEN fv.search_tsv @@ p.tsq                                       THEN 2
            ELSE 1
          END AS tier,
          GREATEST(similarity(fv.name_ar_norm, p.q),
                   similarity(fv.name_en_norm, p.q),
                   similarity(immutable_array_to_string(fv.aliases_norm, ' '), p.q)) AS sim,
          ts_rank(fv.search_tsv, p.tsq) AS ftrank
        FROM food_versions fv, params p
        WHERE fv.is_in_active_release
          AND (${query.category ?? null}::text IS NULL OR fv.category_slug = ${query.category ?? null})
          AND (${query.foodType ?? null}::text IS NULL OR fv.food_type::text = ${query.foodType ?? null})
          AND (${query.preparationState ?? null}::text IS NULL OR fv.preparation_state::text = ${query.preparationState ?? null})
          AND (${query.brand ?? null}::text IS NULL OR fv.brand_name_norm = normalize_arabic(${query.brand ?? null}))
          AND (
            fv.name_ar_norm % p.q OR fv.name_en_norm % p.q
            OR immutable_array_to_string(fv.aliases_norm, ' ') % p.q
            OR fv.search_tsv @@ p.tsq
            OR fv.name_ar_norm LIKE p.q || '%' OR fv.name_en_norm LIKE p.q || '%'
          )
      )
      SELECT * FROM scored
      ORDER BY tier DESC, sim DESC, ftrank DESC, data_confidence DESC, id
      LIMIT ${query.limit + 1} OFFSET ${query.offset}`;

    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((row) => this.toCard(row));
    return { items, hasMore };
  }

  /** Session-scoped trigram threshold; Arabic food words are short (ADR 0003). */
  async prepareSession(): Promise<void> {
    await this.prisma.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', '0.25', false)`;
  }

  async byBarcode(code: string): Promise<FoodSearchCard | null> {
    const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT fv.id, fv.food_id, fv.slug, fv.name_ar, fv.name_en, fv.brand_name,
             fv.category_slug, fv.food_type::text AS food_type,
             fv.preparation_state::text AS preparation_state,
             fv.nutrients, fv.default_portion_grams, fv.image_refs, 4 AS tier
      FROM food_versions fv
      WHERE fv.is_in_active_release AND fv.barcodes @> ARRAY[${code}]
      LIMIT 1`;
    const row = rows[0];
    return row ? this.toCard(row) : null;
  }

  private toCard(row: RawSearchRow): FoodSearchCard {
    const imageRefs = row.image_refs as Array<{ kind?: string }> | null;
    return {
      id: row.id,
      foodId: row.food_id,
      slug: row.slug,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      brandName: row.brand_name,
      categorySlug: row.category_slug,
      foodType: row.food_type,
      preparationState: row.preparation_state,
      energyKcalPer100g: row.nutrients?.energy_kcal ?? null,
      proteinGPer100g: row.nutrients?.protein_g ?? null,
      defaultPortionGrams: row.default_portion_grams === null ? null : Number(row.default_portion_grams),
      imageRef: Array.isArray(imageRefs) ? (imageRefs[0] ?? null) : null,
      matchTier: row.tier,
    };
  }
}

export { Prisma };
