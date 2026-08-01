import {
  CalcValidationError,
  type CalcFieldError,
  type CalcInputs,
  type CalcPolicyConfig,
  type CalcResult,
  type CalcWarning,
} from "./types";

/** Full years between birthDate and asOf, calendar-correct. */
export function ageYearsAt(birthDate: string, asOf: Date): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** Mifflin–St Jeor BMR. Exposed for direct unit testing. */
export function mifflinStJeorBmr(sex: "male" | "female", weightKg: number, heightCm: number, ageYears: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function validate(inputs: CalcInputs, policy: CalcPolicyConfig, asOf: Date): CalcFieldError[] {
  const errors: CalcFieldError[] = [];
  const g = policy.guardrails;

  if (inputs.sex !== "male" && inputs.sex !== "female") {
    errors.push({ field: "sex", code: "invalid", message: "sex must be male or female" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inputs.birthDate) || Number.isNaN(Date.parse(inputs.birthDate))) {
    errors.push({ field: "birthDate", code: "invalid", message: "birthDate must be an ISO date" });
  } else {
    const age = ageYearsAt(inputs.birthDate, asOf);
    if (age < g.minAgeYears)
      errors.push({ field: "birthDate", code: "age_below_minimum", message: `age must be at least ${g.minAgeYears}` });
    if (age > g.maxAgeYears)
      errors.push({ field: "birthDate", code: "age_above_maximum", message: `age must be at most ${g.maxAgeYears}` });
  }
  if (!Number.isFinite(inputs.heightCm) || inputs.heightCm < 50 || inputs.heightCm > 280) {
    errors.push({ field: "heightCm", code: "out_of_range", message: "heightCm must be between 50 and 280" });
  }
  if (!Number.isFinite(inputs.weightKg) || inputs.weightKg < 20 || inputs.weightKg >= 500) {
    errors.push({ field: "weightKg", code: "out_of_range", message: "weightKg must be between 20 and 500" });
  }
  if (!(inputs.activityLevel in policy.activityMultipliers)) {
    errors.push({ field: "activityLevel", code: "invalid", message: "unknown activity level" });
  }
  if (inputs.goalType !== "lose" && inputs.goalType !== "maintain" && inputs.goalType !== "gain") {
    errors.push({ field: "goalType", code: "invalid", message: "goal must be lose, maintain or gain" });
  }
  if (inputs.goalRateKgPerWeek !== undefined) {
    if (!Number.isFinite(inputs.goalRateKgPerWeek) || inputs.goalRateKgPerWeek < 0) {
      errors.push({ field: "goalRateKgPerWeek", code: "invalid", message: "rate must be a non-negative number" });
    }
  }
  return errors;
}

/**
 * Versioned, deterministic calorie/macro calculation. Pure: same inputs +
 * policy + asOf date always produce the same result. All assumptions are
 * surfaced in `explanation`; guardrail interventions become `warnings` —
 * the engine never hides an adjustment.
 */
export function calculateEnergyTargets(
  inputs: CalcInputs,
  policy: CalcPolicyConfig,
  policyVersion: number,
  asOf: Date,
): CalcResult {
  const errors = validate(inputs, policy, asOf);
  if (errors.length > 0) throw new CalcValidationError(errors);

  const warnings: CalcWarning[] = [];
  const g = policy.guardrails;
  const ageYears = ageYearsAt(inputs.birthDate, asOf);
  const bmr = mifflinStJeorBmr(inputs.sex, inputs.weightKg, inputs.heightCm, ageYears);
  const multiplier = policy.activityMultipliers[inputs.activityLevel];
  const maintenance = bmr * multiplier;

  // Requested rate → applied rate (clamped to policy maximum).
  const requestedRate = inputs.goalRateKgPerWeek ?? null;
  let appliedRate = 0;
  if (inputs.goalType === "maintain") {
    if (requestedRate !== null && requestedRate > 0) {
      warnings.push({ code: "rate_ignored_for_maintain", message: "Goal is maintain; rate of change ignored." });
    }
  } else {
    appliedRate = requestedRate ?? 0.5; // policy-documented default rate
    if (appliedRate > g.goalRateMaxKgPerWeek) {
      appliedRate = g.goalRateMaxKgPerWeek;
      warnings.push({
        code: "goal_rate_clamped_to_policy_max",
        message: `Rate clamped to policy maximum of ${g.goalRateMaxKgPerWeek} kg/week.`,
      });
    }
  }

  // Daily energy delta from rate; clamp to deficit/surplus guardrails.
  let delta = (appliedRate * policy.kcalPerKgBodyMass) / 7;
  if (inputs.goalType === "lose" && delta > g.maxDailyDeficitKcal) {
    delta = g.maxDailyDeficitKcal;
    warnings.push({
      code: "deficit_clamped_to_policy_max",
      message: `Daily deficit clamped to ${g.maxDailyDeficitKcal} kcal.`,
    });
  }
  if (inputs.goalType === "gain" && delta > g.maxDailySurplusKcal) {
    delta = g.maxDailySurplusKcal;
    warnings.push({
      code: "surplus_clamped_to_policy_max",
      message: `Daily surplus clamped to ${g.maxDailySurplusKcal} kcal.`,
    });
  }
  const signedDelta = inputs.goalType === "lose" ? -delta : inputs.goalType === "gain" ? delta : 0;

  // Minimum-calories floor.
  let target = maintenance + signedDelta;
  const minCalories = inputs.sex === "male" ? g.minCaloriesMale : g.minCaloriesFemale;
  if (target < minCalories) {
    target = minCalories;
    warnings.push({
      code: "target_raised_to_minimum_calories",
      message: `Target raised to the safe minimum of ${minCalories} kcal/day.`,
    });
  }

  const roundedTarget = roundTo(target, policy.rounding.calories);
  const roundedBmr = roundTo(bmr, 1);
  const roundedMaintenance = roundTo(maintenance, policy.rounding.calories);

  const m = policy.macroDefaults;
  const macros = {
    proteinG: roundTo((roundedTarget * (m.proteinPct / 100)) / 4, policy.rounding.macrosG),
    carbsG: roundTo((roundedTarget * (m.carbsPct / 100)) / 4, policy.rounding.macrosG),
    fatG: roundTo((roundedTarget * (m.fatPct / 100)) / 9, policy.rounding.macrosG),
    proteinPct: m.proteinPct,
    carbsPct: m.carbsPct,
    fatPct: m.fatPct,
  };

  return {
    bmr: roundedBmr,
    maintenanceKcal: roundedMaintenance,
    targetKcal: roundedTarget,
    appliedDeltaKcal: roundTo(roundedTarget - roundedMaintenance, 1),
    macros,
    warnings,
    explanation: {
      equation: "mifflin_st_jeor",
      policyVersion,
      ageYears,
      activityMultiplier: multiplier,
      requestedRateKgPerWeek: requestedRate,
      appliedRateKgPerWeek: appliedRate,
      assumptions: [
        `BMR via Mifflin–St Jeor (${inputs.sex}).`,
        `Maintenance = BMR × ${multiplier} (${inputs.activityLevel}).`,
        `1 kg body mass ≈ ${policy.kcalPerKgBodyMass} kcal.`,
        `Macros: ${m.proteinPct}% protein / ${m.carbsPct}% carbs / ${m.fatPct}% fat of target calories.`,
      ],
      disclaimers: policy.disclaimers,
    },
  };
}
