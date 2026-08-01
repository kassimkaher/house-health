import { z } from "zod";

export const foodTypeSchema = z.enum(["generic_food", "branded_product", "prepared_dish", "recipe_template", "user_recipe"]);
export const preparationStateSchema = z.enum(["raw", "cooked", "baked", "grilled", "fried", "steamed", "canned", "dried", "other"]);
export const reviewStatusSchema = z.enum(["imported", "normalized", "needs_review", "verified", "rejected", "archived"]);
export const publicationStatusSchema = z.enum(["draft", "published", "deprecated"]);
export const aliasKindSchema = z.enum(["iraqi_dialect", "msa_variant", "english", "transliteration", "colloquial_other", "brand_variant"]);
export const barcodeTypeSchema = z.enum(["ean13", "ean8", "upc_a", "upc_e", "code128", "other"]);
export const portionSourceSchema = z.enum(["provider", "curated", "user_submitted", "inferred"]);

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a kebab-case slug").min(2).max(120);
const tagArray = z.array(z.string().trim().min(1).max(60)).max(40);

export const createFoodSchema = z
  .object({
    slug: slugSchema.optional(),
    foodType: foodTypeSchema,
    nameAr: z.string().trim().min(1).max(250),
    nameEn: z.string().trim().min(1).max(250),
    descriptionAr: z.string().trim().max(2000).nullable().optional(),
    descriptionEn: z.string().trim().max(2000).nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    brandId: z.string().uuid().nullable().optional(),
    preparationState: preparationStateSchema.default("other"),
    defaultPortionGrams: z.number().positive().max(50000).nullable().optional(),
    densityGPerMl: z.number().positive().max(30).nullable().optional(),
    edibleFraction: z.number().gt(0).max(1).nullable().optional(),
    marketTags: tagArray.default([]),
    dietaryTags: tagArray.default([]),
    allergenTags: tagArray.default([]),
    dataConfidence: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export type CreateFoodDto = z.infer<typeof createFoodSchema>;

export const updateFoodSchema = createFoodSchema.partial().strict();
export type UpdateFoodDto = z.infer<typeof updateFoodSchema>;

export const setFoodNutrientsSchema = z
  .object({
    nutrients: z
      .array(
        z
          .object({
            key: z.string().min(1).max(60),
            valuePer100g: z.number().min(0).max(100000),
            originalValue: z.number().nullable().optional(),
            originalUnit: z.string().trim().max(30).nullable().optional(),
            originalBasis: z.string().trim().max(60).nullable().optional(),
            derivation: z.enum(["measured", "calculated", "estimated", "label"]).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();
export type SetFoodNutrientsDto = z.infer<typeof setFoodNutrientsSchema>;

export const addAliasSchema = z
  .object({
    alias: z.string().trim().min(1).max(250),
    kind: aliasKindSchema,
    locale: z.string().trim().max(20).nullable().optional(),
    source: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
export type AddAliasDto = z.infer<typeof addAliasSchema>;

export const addBarcodeSchema = z
  .object({
    code: z.string().regex(/^[0-9]{6,14}$/, "must be 6-14 digits"),
    type: barcodeTypeSchema.default("ean13"),
    source: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
export type AddBarcodeDto = z.infer<typeof addBarcodeSchema>;

export const upsertPortionSchema = z
  .object({
    labelAr: z.string().trim().min(1).max(120),
    labelEn: z.string().trim().min(1).max(120),
    grams: z.number().positive().max(50000),
    source: portionSourceSchema.default("curated"),
    confidence: z.number().min(0).max(1).default(0.8),
    locale: z.string().trim().max(20).nullable().optional(),
    isDefault: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type UpsertPortionDto = z.infer<typeof upsertPortionSchema>;

export const reviewTransitionSchema = z
  .object({
    to: reviewStatusSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ReviewTransitionDto = z.infer<typeof reviewTransitionSchema>;

export const listFoodsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    reviewStatus: reviewStatusSchema.optional(),
    publicationStatus: publicationStatusSchema.optional(),
    foodType: foodTypeSchema.optional(),
    categoryId: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ListFoodsQuery = z.infer<typeof listFoodsQuerySchema>;

// --- Taxonomy -------------------------------------------------------------

export const upsertCategorySchema = z
  .object({
    slug: slugSchema,
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z.string().trim().min(1).max(120),
    parentId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type UpsertCategoryDto = z.infer<typeof upsertCategorySchema>;

export const upsertBrandSchema = z
  .object({
    slug: slugSchema,
    nameAr: z.string().trim().min(1).max(160).nullable().optional(),
    nameEn: z.string().trim().min(1).max(160),
    manufacturer: z.string().trim().max(160).nullable().optional(),
    countryCode: z.string().length(2).toUpperCase().nullable().optional(),
  })
  .strict();
export type UpsertBrandDto = z.infer<typeof upsertBrandSchema>;

export const upsertNutrientDefinitionSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/).min(2).max(60),
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z.string().trim().min(1).max(120),
    unit: z.enum(["kcal", "kJ", "g", "mg", "µg"]),
    isCore: z.boolean().default(false),
    displayOrder: z.number().int().min(0).max(1000),
    precision: z.number().int().min(0).max(4).default(1),
  })
  .strict();
export type UpsertNutrientDefinitionDto = z.infer<typeof upsertNutrientDefinitionSchema>;
