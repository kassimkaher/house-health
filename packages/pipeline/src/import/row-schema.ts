import { z } from "zod";

const optionalNumber = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
  })
  .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), "must be a non-negative number");

const requiredNumber = z
  .union([z.string(), z.number()])
  .refine((v) => v !== "" && v !== null && v !== undefined, "required")
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v >= 0, "must be a non-negative number");

/** One import file row after CSV/JSON parsing, before normalization. */
export const importRowSchema = z
  .object({
    external_id: z.string().trim().min(1, "required").max(120),
    name_ar: z.string().trim().min(1, "required").max(250),
    name_en: z.string().trim().min(1, "required").max(250),
    food_type: z
      .enum(["generic_food", "branded_product", "prepared_dish"])
      .optional()
      .default("generic_food"),
    preparation_state: z
      .enum(["raw", "cooked", "baked", "grilled", "fried", "steamed", "canned", "dried", "other"])
      .optional()
      .default("other"),
    category_slug: z.string().trim().max(120).optional(),
    brand_slug: z.string().trim().max(120).optional(),
    barcode: z
      .string()
      .trim()
      .regex(/^[0-9]{6,14}$/, "must be 6-14 digits")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    default_portion_grams: optionalNumber,
    aliases_iraqi: z.string().trim().max(1000).optional(),
    aliases_en: z.string().trim().max(1000).optional(),
    energy_kcal: requiredNumber,
    protein_g: requiredNumber,
    carbs_g: requiredNumber,
    fat_g: requiredNumber,
    sat_fat_g: optionalNumber,
    fiber_g: optionalNumber,
    sugars_g: optionalNumber,
    sodium_mg: optionalNumber,
    cholesterol_mg: optionalNumber,
    portion_label_ar: z.string().trim().max(120).optional(),
    portion_label_en: z.string().trim().max(120).optional(),
    portion_grams: optionalNumber,
  })
  .passthrough(); // unknown columns are preserved in provenance, not rejected

export type ImportRow = z.infer<typeof importRowSchema>;

export const REQUIRED_COLUMNS = [
  "external_id",
  "name_ar",
  "name_en",
  "energy_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
] as const;

export const NUTRIENT_COLUMNS = [
  "energy_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sat_fat_g",
  "fiber_g",
  "sugars_g",
  "sodium_mg",
  "cholesterol_mg",
] as const;
