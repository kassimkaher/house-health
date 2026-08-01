import { z } from "zod";

export const quantityUnitSchema = z.enum(["g", "kg", "ml", "l", "portion", "serving"]);

const quantityFields = {
  quantity: z.number().positive().max(100000),
  unit: quantityUnitSchema,
  portionLabelEn: z.string().trim().min(1).max(120).optional(),
};

// --- Recipes ---------------------------------------------------------------

export const recipeIngredientInputSchema = z
  .object({
    foodId: z.string().uuid(),
    ...quantityFields,
    preparationNote: z.string().trim().max(300).optional(),
  })
  .strict();
export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;

export const createRecipeSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(200),
    titleEn: z.string().trim().min(1).max(200).optional(),
    servings: z.number().positive().max(200),
    cookedWeightGrams: z.number().positive().max(100000).optional(),
    instructions: z
      .array(z.object({ step: z.number().int().positive(), textAr: z.string().max(2000), textEn: z.string().max(2000).optional() }).strict())
      .max(50)
      .optional(),
    ingredients: z.array(recipeIngredientInputSchema).min(1).max(60),
  })
  .strict();
export type CreateRecipeDto = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial().strict();
export type UpdateRecipeDto = z.infer<typeof updateRecipeSchema>;

// --- Meal groups -----------------------------------------------------------

export const mealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack", "custom"]);

export const mealGroupItemInputSchema = z
  .object({
    itemType: z.enum(["food", "recipe"]),
    foodId: z.string().uuid().optional(),
    recipeId: z.string().uuid().optional(),
    ...quantityFields,
  })
  .strict()
  .refine((v) => (v.itemType === "food" ? !!v.foodId : !!v.recipeId), {
    message: "foodId required for food items, recipeId for recipe items",
    path: ["itemType"],
  });
export type MealGroupItemInput = z.infer<typeof mealGroupItemInputSchema>;

export const upsertMealGroupSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().min(1).max(200).optional(),
    mealSlot: mealSlotSchema.optional(),
    isFavorite: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    items: z.array(mealGroupItemInputSchema).min(1).max(40),
  })
  .strict();
export type UpsertMealGroupDto = z.infer<typeof upsertMealGroupSchema>;

// --- Diary -----------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const diaryStatusSchema = z.enum(["planned", "consumed", "skipped"]);

export const createDiaryEntrySchema = z
  .object({
    entryDate: isoDate,
    mealSlot: mealSlotSchema,
    customSlotName: z.string().trim().min(1).max(60).optional(),
    status: diaryStatusSchema.default("consumed"),
    itemType: z.enum(["food", "recipe", "meal_group"]),
    foodId: z.string().uuid().optional(),
    recipeId: z.string().uuid().optional(),
    mealGroupId: z.string().uuid().optional(),
    ...quantityFields,
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.itemType === "food" && !!v.foodId) ||
      (v.itemType === "recipe" && !!v.recipeId) ||
      (v.itemType === "meal_group" && !!v.mealGroupId),
    { message: "id matching itemType is required", path: ["itemType"] },
  );
export type CreateDiaryEntryDto = z.infer<typeof createDiaryEntrySchema>;

export const updateDiaryEntrySchema = z
  .object({
    entryDate: isoDate.optional(),
    mealSlot: mealSlotSchema.optional(),
    customSlotName: z.string().trim().min(1).max(60).nullable().optional(),
    status: diaryStatusSchema.optional(),
    quantity: z.number().positive().max(100000).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type UpdateDiaryEntryDto = z.infer<typeof updateDiaryEntrySchema>;

export const copyDiarySchema = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    mealSlot: mealSlotSchema.optional(),
    asPlanned: z.boolean().default(true),
  })
  .strict();
export type CopyDiaryDto = z.infer<typeof copyDiarySchema>;

// --- Favorites -------------------------------------------------------------

export const shortcutSchema = z
  .object({
    entityType: z.enum(["food", "recipe", "meal_group"]),
    entityId: z.string().uuid(),
    kind: z.enum(["favorite", "pin"]).default("favorite"),
  })
  .strict();
export type ShortcutDto = z.infer<typeof shortcutSchema>;
