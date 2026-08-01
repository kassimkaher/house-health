import { z } from "zod";

export const sexSchema = z.enum(["male", "female"]);
export const activityLevelSchema = z.enum(["sedentary", "light", "moderate", "active", "very_active"]);
export const goalTypeSchema = z.enum(["lose", "maintain", "gain"]);
export const unitPreferenceSchema = z.enum(["metric", "imperial"]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)")
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date");

/** IANA zone name; validated against the runtime tz database. */
const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "must be a valid IANA time zone");

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable(),
    locale: z.string().trim().min(2).max(20),
    preferredLanguage: z.enum(["ar", "en"]),
    timezone: timezoneSchema,
    sex: sexSchema.nullable(),
    birthDate: isoDateSchema.nullable(),
    heightCm: z.number().min(50).max(280).nullable(),
    currentWeightKg: z.number().min(20).lt(500).nullable(),
    targetWeightKg: z.number().min(20).lt(500).nullable(),
    activityLevel: activityLevelSchema,
    goalType: goalTypeSchema,
    goalRateKgPerWeek: z.number().min(0).max(2).nullable(),
    dietaryPrefs: z.array(z.string().trim().min(1).max(60)).max(30),
    allergies: z.array(z.string().trim().min(1).max(60)).max(30),
    excludedFoods: z.array(z.string().trim().min(1).max(120)).max(100),
    unitPreference: unitPreferenceSchema,
    medicalAck: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export interface ProfileView {
  displayName: string | null;
  locale: string;
  preferredLanguage: string;
  timezone: string;
  sex: "male" | "female" | null;
  birthDate: string | null;
  heightCm: number | null;
  currentWeightKg: number | null;
  targetWeightKg: number | null;
  activityLevel: z.infer<typeof activityLevelSchema>;
  goalType: z.infer<typeof goalTypeSchema>;
  goalRateKgPerWeek: number | null;
  dietaryPrefs: string[];
  allergies: string[];
  excludedFoods: string[];
  unitPreference: z.infer<typeof unitPreferenceSchema>;
  medicalAckAt: string | null;
  activeCalcSnapshotId: string | null;
}

// --- Weight history -------------------------------------------------------

export const upsertWeightSchema = z
  .object({
    measuredOn: isoDateSchema,
    weightKg: z.number().min(20).lt(500),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type UpsertWeightDto = z.infer<typeof upsertWeightSchema>;

export const updateWeightSchema = z
  .object({
    weightKg: z.number().min(20).lt(500).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type UpdateWeightDto = z.infer<typeof updateWeightSchema>;

export const listWeightQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(90),
  })
  .strict();
export type ListWeightQuery = z.infer<typeof listWeightQuerySchema>;

export interface WeightEntryView {
  id: string;
  measuredOn: string;
  weightKg: number;
  source: string;
  note: string | null;
  createdAt: string;
}

export interface WeightTrendView {
  latest: WeightEntryView | null;
  changeKg7d: number | null;
  changeKg30d: number | null;
  targetWeightKg: number | null;
  remainingToTargetKg: number | null;
  entryCount: number;
}

// --- Calculation ----------------------------------------------------------

export interface CalcMacroView {
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}

export interface CalcSnapshotView {
  id: string;
  policyKey: string;
  policyVersion: number;
  bmr: number;
  maintenanceKcal: number;
  targetKcal: number;
  appliedDeltaKcal: number;
  macros: CalcMacroView;
  warnings: Array<{ code: string; message: string }>;
  explanation: {
    equation: string;
    policyVersion: number;
    ageYears: number;
    activityMultiplier: number;
    requestedRateKgPerWeek: number | null;
    appliedRateKgPerWeek: number;
    assumptions: string[];
    disclaimers: string[];
  };
  effectiveFrom: string;
}
