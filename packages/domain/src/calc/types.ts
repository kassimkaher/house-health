export type CalcSex = "male" | "female";
export type CalcActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type CalcGoalType = "lose" | "maintain" | "gain";

export interface CalcInputs {
  sex: CalcSex;
  /** ISO date string YYYY-MM-DD */
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activityLevel: CalcActivityLevel;
  goalType: CalcGoalType;
  /** Desired rate of weight change in kg/week; ignored for maintain. */
  goalRateKgPerWeek?: number | undefined;
}

/** Shape of calculation_policies.config — seeded as mifflin_st_jeor v1. */
export interface CalcPolicyConfig {
  equation: "mifflin_st_jeor";
  activityMultipliers: Record<CalcActivityLevel, number>;
  kcalPerKgBodyMass: number;
  guardrails: {
    maxDailyDeficitKcal: number;
    maxDailySurplusKcal: number;
    minCaloriesFemale: number;
    minCaloriesMale: number;
    minAgeYears: number;
    maxAgeYears: number;
    goalRateMaxKgPerWeek: number;
  };
  macroDefaults: { proteinPct: number; carbsPct: number; fatPct: number };
  rounding: { calories: number; macrosG: number };
  disclaimers: string[];
}

export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}

export type CalcWarningCode =
  | "deficit_clamped_to_policy_max"
  | "surplus_clamped_to_policy_max"
  | "target_raised_to_minimum_calories"
  | "goal_rate_clamped_to_policy_max"
  | "rate_ignored_for_maintain";

export interface CalcWarning {
  code: CalcWarningCode;
  message: string;
}

export interface CalcResult {
  bmr: number;
  maintenanceKcal: number;
  targetKcal: number;
  /** Signed daily delta actually applied (negative = deficit). */
  appliedDeltaKcal: number;
  macros: MacroTargets;
  warnings: CalcWarning[];
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
}

export interface CalcFieldError {
  field: string;
  code: string;
  message: string;
}

export class CalcValidationError extends Error {
  constructor(public readonly errors: CalcFieldError[]) {
    super(`Calculation input validation failed: ${errors.map((e) => e.field).join(", ")}`);
    this.name = "CalcValidationError";
  }
}
