import { ageYearsAt, calculateEnergyTargets, mifflinStJeorBmr } from "./engine";
import { CalcValidationError, type CalcInputs, type CalcPolicyConfig } from "./types";

const POLICY: CalcPolicyConfig = {
  equation: "mifflin_st_jeor",
  activityMultipliers: { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 },
  kcalPerKgBodyMass: 7700,
  guardrails: {
    maxDailyDeficitKcal: 1000,
    maxDailySurplusKcal: 500,
    minCaloriesFemale: 1200,
    minCaloriesMale: 1500,
    minAgeYears: 18,
    maxAgeYears: 100,
    goalRateMaxKgPerWeek: 1.0,
  },
  macroDefaults: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  rounding: { calories: 10, macrosG: 1 },
  disclaimers: ["estimates_not_medical_advice"],
};

const ASOF = new Date("2026-08-01T00:00:00Z");

const base: CalcInputs = {
  sex: "male",
  birthDate: "1996-08-01", // exactly 30 at ASOF
  heightCm: 180,
  weightKg: 80,
  activityLevel: "moderate",
  goalType: "maintain",
};

describe("ageYearsAt", () => {
  it("counts full years only", () => {
    expect(ageYearsAt("1996-08-01", ASOF)).toBe(30);
    expect(ageYearsAt("1996-08-02", ASOF)).toBe(29); // birthday tomorrow
    expect(ageYearsAt("1996-07-31", ASOF)).toBe(30);
  });
});

describe("mifflinStJeorBmr", () => {
  it("matches the published equation for males", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(mifflinStJeorBmr("male", 80, 180, 30)).toBe(1780);
  });
  it("matches the published equation for females", () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    expect(mifflinStJeorBmr("female", 60, 165, 25)).toBeCloseTo(1345.25);
  });
});

describe("calculateEnergyTargets", () => {
  it("computes maintenance with the activity multiplier", () => {
    const r = calculateEnergyTargets(base, POLICY, 1, ASOF);
    expect(r.bmr).toBe(1780);
    expect(r.maintenanceKcal).toBe(2760); // 1780*1.55=2759 → rounded to 10
    expect(r.targetKcal).toBe(r.maintenanceKcal);
    expect(r.warnings).toHaveLength(0);
    expect(r.explanation.policyVersion).toBe(1);
  });

  it("applies a deficit from the requested rate", () => {
    const r = calculateEnergyTargets({ ...base, goalType: "lose", goalRateKgPerWeek: 0.5 }, POLICY, 1, ASOF);
    // delta = 0.5*7700/7 = 550
    expect(r.targetKcal).toBe(2210); // 2759-550=2209 → 2210
    expect(r.appliedDeltaKcal).toBeLessThan(0);
  });

  it("clamps excessive rates and reports both warnings", () => {
    const r = calculateEnergyTargets({ ...base, goalType: "lose", goalRateKgPerWeek: 3 }, POLICY, 1, ASOF);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("goal_rate_clamped_to_policy_max");
    // 1.0 kg/wk = 1100/day > 1000 max deficit → also clamped
    expect(codes).toContain("deficit_clamped_to_policy_max");
    expect(r.targetKcal).toBe(1760); // 2759-1000=1759 → 1760
  });

  it("raises target to the sex-specific minimum and warns", () => {
    const r = calculateEnergyTargets(
      { sex: "female", birthDate: "1996-08-01", heightCm: 150, weightKg: 45, activityLevel: "sedentary", goalType: "lose", goalRateKgPerWeek: 1 },
      POLICY, 1, ASOF,
    );
    expect(r.targetKcal).toBe(1200);
    expect(r.warnings.map((w) => w.code)).toContain("target_raised_to_minimum_calories");
  });

  it("clamps surplus for gain goals", () => {
    const r = calculateEnergyTargets({ ...base, goalType: "gain", goalRateKgPerWeek: 1 }, POLICY, 1, ASOF);
    // 1100/day > 500 max surplus
    expect(r.warnings.map((w) => w.code)).toContain("surplus_clamped_to_policy_max");
    expect(r.targetKcal).toBe(3260); // 2759+500=3259 → 3260
  });

  it("warns when a rate is supplied with maintain", () => {
    const r = calculateEnergyTargets({ ...base, goalRateKgPerWeek: 0.5 }, POLICY, 1, ASOF);
    expect(r.warnings.map((w) => w.code)).toContain("rate_ignored_for_maintain");
    expect(r.targetKcal).toBe(r.maintenanceKcal);
  });

  it("produces macro grams consistent with the split", () => {
    const r = calculateEnergyTargets(base, POLICY, 1, ASOF);
    // 2760 kcal: protein 30% = 828/4 = 207 g; carbs 40% = 1104/4=276; fat 30% = 828/9=92
    expect(r.macros).toMatchObject({ proteinG: 207, carbsG: 276, fatG: 92 });
  });

  describe("boundary validation", () => {
    const cases: Array<[string, Partial<CalcInputs>, string]> = [
      ["under-age", { birthDate: "2010-01-01" }, "birthDate"],
      ["over max age", { birthDate: "1920-01-01" }, "birthDate"],
      ["height too low", { heightCm: 40 }, "heightCm"],
      ["height too high", { heightCm: 300 }, "heightCm"],
      ["weight too low", { weightKg: 10 }, "weightKg"],
      ["weight at 500", { weightKg: 500 }, "weightKg"],
      ["NaN weight", { weightKg: Number.NaN }, "weightKg"],
      ["negative rate", { goalType: "lose", goalRateKgPerWeek: -1 }, "goalRateKgPerWeek"],
      ["malformed date", { birthDate: "01/01/1990" }, "birthDate"],
    ];
    for (const [name, patch, field] of cases) {
      it(`rejects ${name}`, () => {
        try {
          calculateEnergyTargets({ ...base, ...patch }, POLICY, 1, ASOF);
          fail("expected CalcValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(CalcValidationError);
          expect((err as CalcValidationError).errors.map((e) => e.field)).toContain(field);
        }
      });
    }

    it("accepts boundary age exactly at minimum", () => {
      const r = calculateEnergyTargets({ ...base, birthDate: "2008-08-01" }, POLICY, 1, ASOF); // exactly 18
      expect(r.explanation.ageYears).toBe(18);
    });
  });

  it("is deterministic for identical inputs", () => {
    const a = calculateEnergyTargets(base, POLICY, 1, ASOF);
    const b = calculateEnergyTargets(base, POLICY, 1, ASOF);
    expect(a).toEqual(b);
  });
});
