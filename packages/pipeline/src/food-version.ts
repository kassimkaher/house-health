import { createHash } from "node:crypto";
import type { Prisma } from "@hh/database";

/** Food loaded with everything the denormalized version row needs. */
export const VERSION_SOURCE_INCLUDE = {
  aliases: true,
  nutrients: { include: { nutrient: true } },
  barcodes: true,
  portions: { orderBy: { sortOrder: "asc" as const } },
  brand: true,
  category: true,
} satisfies Prisma.FoodInclude;

export type VersionSourceFood = Prisma.FoodGetPayload<{ include: typeof VERSION_SOURCE_INCLUDE }>;

export interface FoodVersionPayload {
  slug: string;
  foodType: VersionSourceFood["foodType"];
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  aliasesNorm: string[];
  aliasesDisplay: Array<{ alias: string; kind: string; locale: string | null }>;
  brandName: string | null;
  categorySlug: string | null;
  categoryPath: string | null;
  preparationState: VersionSourceFood["preparationState"];
  barcodes: string[];
  defaultPortionGrams: string | null;
  densityGPerMl: string | null;
  edibleFraction: string | null;
  marketTags: string[];
  dietaryTags: string[];
  allergenTags: string[];
  imageRefs: unknown;
  nutrients: Record<string, number>;
  portions: Array<{
    labelAr: string;
    labelEn: string;
    grams: number;
    source: string;
    locale: string | null;
    isDefault: boolean;
  }>;
  dataConfidence: string;
}

/** Deterministic JSON: sorted keys, no undefined, stable number rendering. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function decimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * Flatten an editorial food into the immutable, search-ready version payload.
 * `categoryPathBySlug` maps category slug → "parent/child" path (release
 * builder resolves the tree once per run).
 */
export function buildFoodVersionPayload(
  food: VersionSourceFood,
  categoryPathBySlug: ReadonlyMap<string, string>,
): { payload: FoodVersionPayload; contentChecksum: string } {
  const aliases = [...food.aliases].sort((a, b) => (a.alias < b.alias ? -1 : 1));
  const nutrients = Object.fromEntries(
    [...food.nutrients]
      .sort((a, b) => (a.nutrient.key < b.nutrient.key ? -1 : 1))
      .map((n) => [n.nutrient.key, Number(n.valuePer100g)]),
  );
  const payload: FoodVersionPayload = {
    slug: food.slug,
    foodType: food.foodType,
    nameAr: food.nameAr,
    nameEn: food.nameEn,
    descriptionAr: food.descriptionAr,
    descriptionEn: food.descriptionEn,
    aliasesNorm: [], // filled by the database (normalize_arabic) — checksum uses raw aliases below
    aliasesDisplay: aliases.map((a) => ({ alias: a.alias, kind: a.kind, locale: a.locale })),
    brandName: food.brand?.nameEn ?? null,
    categorySlug: food.category?.slug ?? null,
    categoryPath: food.category ? (categoryPathBySlug.get(food.category.slug) ?? food.category.slug) : null,
    preparationState: food.preparationState,
    barcodes: food.barcodes.filter((b) => b.isActive).map((b) => b.code).sort(),
    defaultPortionGrams: decimalString(food.defaultPortionGrams),
    densityGPerMl: decimalString(food.densityGPerMl),
    edibleFraction: decimalString(food.edibleFraction),
    marketTags: [...food.marketTags].sort(),
    dietaryTags: [...food.dietaryTags].sort(),
    allergenTags: [...food.allergenTags].sort(),
    imageRefs: food.imageRefs ?? null,
    nutrients,
    portions: [...food.portions]
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.labelEn < b.labelEn ? -1 : 1))
      .map((p) => ({
        labelAr: p.labelAr,
        labelEn: p.labelEn,
        grams: Number(p.grams),
        source: p.source,
        locale: p.locale,
        isDefault: p.isDefault,
      })),
    dataConfidence: food.dataConfidence.toString(),
  };
  const contentChecksum = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  return { payload, contentChecksum };
}

/** Build slug → "parent/child" path map from the flat category list. */
export function buildCategoryPaths(
  categories: Array<{ id: string; slug: string; parentId: string | null }>,
): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const paths = new Map<string, string>();
  for (const cat of categories) {
    const parts = [cat.slug];
    let cursor = cat.parentId ? byId.get(cat.parentId) : undefined;
    let guard = 0;
    while (cursor && guard < 10) {
      parts.unshift(cursor.slug);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }
    paths.set(cat.slug, parts.join("/"));
  }
  return paths;
}

export { canonicalJson };
