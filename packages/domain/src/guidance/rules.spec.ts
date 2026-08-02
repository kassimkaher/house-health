import { evaluateDailyGuidance, evaluateWeightGuidance } from "./rules";

describe("evaluateDailyGuidance", () => {
  it("flags over-target consumption", () => {
    const msgs = evaluateDailyGuidance({
      consumedKcal: 2500,
      targetKcal: 2000,
      proteinG: 100,
      proteinTargetG: 100,
      fiberG: 20,
      sodiumMg: 1000,
    });
    expect(msgs.map((m) => m.ruleId)).toContain("daily.over_target_kcal");
    expect(msgs.find((m) => m.ruleId === "daily.over_target_kcal")?.severity).toBe("attention");
  });

  it("flags significant under-logging but not zero (unlogged day)", () => {
    const under = evaluateDailyGuidance({
      consumedKcal: 500,
      targetKcal: 2000,
      proteinG: 20,
      proteinTargetG: 100,
      fiberG: 20,
      sodiumMg: 100,
    });
    expect(under.map((m) => m.ruleId)).toContain("daily.under_target_kcal");

    const zero = evaluateDailyGuidance({
      consumedKcal: 0,
      targetKcal: 2000,
      proteinG: 0,
      proteinTargetG: 100,
      fiberG: 0,
      sodiumMg: 0,
    });
    expect(zero.map((m) => m.ruleId)).not.toContain("daily.under_target_kcal");
  });

  it("says nothing extra within the tolerance band", () => {
    const msgs = evaluateDailyGuidance({
      consumedKcal: 2050,
      targetKcal: 2000,
      proteinG: 150,
      proteinTargetG: 150,
      fiberG: 25,
      sodiumMg: 1500,
    });
    expect(msgs).toHaveLength(0);
  });

  it("flags low protein, low fiber, and high sodium independently", () => {
    const msgs = evaluateDailyGuidance({
      consumedKcal: 1800,
      targetKcal: 2000,
      proteinG: 40,
      proteinTargetG: 100,
      fiberG: 5,
      sodiumMg: 3000,
    });
    const ids = msgs.map((m) => m.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining(["daily.protein_below_target", "daily.fiber_low", "daily.sodium_high"]),
    );
  });

  it("every message carries a stable rule id and version", () => {
    const msgs = evaluateDailyGuidance({
      consumedKcal: 3000,
      targetKcal: 2000,
      proteinG: 0,
      proteinTargetG: null,
      fiberG: 0,
      sodiumMg: 0,
    });
    for (const m of msgs) {
      expect(m.ruleId).toMatch(/^daily\./);
      expect(m.version).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("evaluateWeightGuidance", () => {
  it("returns nothing without trend data", () => {
    expect(evaluateWeightGuidance({ changeKg30d: null, goalType: "lose", goalRateKgPerWeek: 0.5 })).toHaveLength(0);
  });

  it("recognizes on-track loss", () => {
    const msgs = evaluateWeightGuidance({ changeKg30d: -2.5, goalType: "lose", goalRateKgPerWeek: 0.5 });
    expect(msgs[0]?.ruleId).toBe("weight.trend_on_track");
  });

  it("recognizes off-track loss (weight barely moving)", () => {
    const msgs = evaluateWeightGuidance({ changeKg30d: -0.1, goalType: "lose", goalRateKgPerWeek: 0.5 });
    expect(msgs[0]?.ruleId).toBe("weight.trend_off_track");
  });

  it("treats maintain goals with a tolerance band", () => {
    expect(evaluateWeightGuidance({ changeKg30d: 0.5, goalType: "maintain", goalRateKgPerWeek: null })[0]?.ruleId).toBe(
      "weight.trend_on_track",
    );
    expect(evaluateWeightGuidance({ changeKg30d: 2, goalType: "maintain", goalRateKgPerWeek: null })[0]?.ruleId).toBe(
      "weight.trend_off_track",
    );
  });
});
