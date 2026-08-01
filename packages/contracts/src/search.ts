import { z } from "zod";
import { foodTypeSchema, preparationStateSchema } from "./catalog";

export const searchFoodsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    category: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(160).optional(),
    foodType: foodTypeSchema.optional(),
    preparationState: preparationStateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(200).default(0),
  })
  .strict();
export type SearchFoodsQuery = z.infer<typeof searchFoodsQuerySchema>;

/** Compact card — everything a result list needs, nothing more. */
export interface FoodSearchCard {
  id: string; // food_version id
  foodId: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  brandName: string | null;
  categorySlug: string | null;
  foodType: string;
  preparationState: string;
  energyKcalPer100g: number | null;
  proteinGPer100g: number | null;
  defaultPortionGrams: number | null;
  imageRef: unknown;
  matchTier: number;
}

export interface FoodSearchResult {
  items: FoodSearchCard[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Full detail — served by /foods/:idOrSlug, never inlined in search. */
export interface FoodDetailView {
  id: string;
  foodId: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  aliases: Array<{ alias: string; kind: string; locale: string | null }>;
  brandName: string | null;
  categorySlug: string | null;
  categoryPath: string | null;
  foodType: string;
  preparationState: string;
  barcodes: string[];
  defaultPortionGrams: number | null;
  densityGPerMl: number | null;
  marketTags: string[];
  dietaryTags: string[];
  allergenTags: string[];
  imageRefs: unknown;
  nutrientsPer100g: Record<string, number>;
  portions: Array<{
    labelAr: string;
    labelEn: string;
    grams: number;
    source: string;
    locale: string | null;
    isDefault: boolean;
  }>;
  dataConfidence: number;
  releaseVersion: string | null;
}
