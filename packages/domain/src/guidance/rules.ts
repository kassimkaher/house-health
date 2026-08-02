/**
 * Deterministic, versioned guidance rules. Every recommendation carries its
 * rule id + version so client behavior and analytics stay auditable. No
 * medical claims — these are threshold observations on logged data only.
 */

export interface GuidanceMessage {
  ruleId: string;
  version: number;
  severity: "info" | "attention";
  messageAr: string;
  messageEn: string;
  params: Record<string, number>;
}

export interface DailyGuidanceInput {
  consumedKcal: number;
  targetKcal: number | null;
  proteinG: number;
  proteinTargetG: number | null;
  fiberG: number;
  sodiumMg: number;
}

/** Thresholds are versioned WITH the rules; changing them bumps versions. */
export const GUIDANCE_THRESHOLDS = {
  overTargetPct: 10, // >10% above target → attention
  underTargetPct: 30, // >30% below target → info (possible under-logging)
  proteinLowPct: 70, // <70% of protein target → info
  fiberLowG: 15,
  sodiumHighMg: 2300,
} as const;

export function evaluateDailyGuidance(input: DailyGuidanceInput): GuidanceMessage[] {
  const messages: GuidanceMessage[] = [];
  const t = GUIDANCE_THRESHOLDS;

  if (input.targetKcal && input.targetKcal > 0) {
    const pct = ((input.consumedKcal - input.targetKcal) / input.targetKcal) * 100;
    if (pct > t.overTargetPct) {
      messages.push({
        ruleId: "daily.over_target_kcal",
        version: 1,
        severity: "attention",
        messageAr: "تجاوزت هدفك اليومي من السعرات",
        messageEn: "You are over your daily calorie target",
        params: { consumedKcal: input.consumedKcal, targetKcal: input.targetKcal, overPct: Math.round(pct) },
      });
    } else if (pct < -t.underTargetPct && input.consumedKcal > 0) {
      messages.push({
        ruleId: "daily.under_target_kcal",
        version: 1,
        severity: "info",
        messageAr: "أنت أقل بكثير من هدفك اليومي — هل سجلت كل وجباتك؟",
        messageEn: "You are well under your daily target — did you log everything?",
        params: { consumedKcal: input.consumedKcal, targetKcal: input.targetKcal, underPct: Math.round(-pct) },
      });
    }
  }
  if (input.proteinTargetG && input.proteinTargetG > 0 && input.consumedKcal > 0) {
    const pct = (input.proteinG / input.proteinTargetG) * 100;
    if (pct < t.proteinLowPct) {
      messages.push({
        ruleId: "daily.protein_below_target",
        version: 1,
        severity: "info",
        messageAr: "البروتين اليوم أقل من هدفك",
        messageEn: "Protein is below your target today",
        params: { proteinG: input.proteinG, targetG: input.proteinTargetG, pct: Math.round(pct) },
      });
    }
  }
  if (input.consumedKcal > 800 && input.fiberG < t.fiberLowG) {
    messages.push({
      ruleId: "daily.fiber_low",
      version: 1,
      severity: "info",
      messageAr: "الألياف اليوم قليلة — جرب الخضروات والبقوليات",
      messageEn: "Fiber is low today — vegetables and legumes help",
      params: { fiberG: input.fiberG, thresholdG: t.fiberLowG },
    });
  }
  if (input.sodiumMg > t.sodiumHighMg) {
    messages.push({
      ruleId: "daily.sodium_high",
      version: 1,
      severity: "attention",
      messageAr: "الصوديوم اليوم مرتفع",
      messageEn: "Sodium is high today",
      params: { sodiumMg: input.sodiumMg, thresholdMg: t.sodiumHighMg },
    });
  }
  return messages;
}

export interface WeightGuidanceInput {
  changeKg30d: number | null;
  goalType: "lose" | "maintain" | "gain";
  goalRateKgPerWeek: number | null;
}

export function evaluateWeightGuidance(input: WeightGuidanceInput): GuidanceMessage[] {
  if (input.changeKg30d === null) return [];
  const expected30d = (input.goalRateKgPerWeek ?? 0.5) * (30 / 7);
  const messages: GuidanceMessage[] = [];
  const onTrack =
    input.goalType === "maintain"
      ? Math.abs(input.changeKg30d) <= 1
      : input.goalType === "lose"
        ? input.changeKg30d <= -0.5 * expected30d
        : input.changeKg30d >= 0.5 * expected30d;
  messages.push(
    onTrack
      ? {
          ruleId: "weight.trend_on_track",
          version: 1,
          severity: "info",
          messageAr: "وزنك يتغير باتجاه هدفك",
          messageEn: "Your weight is trending toward your goal",
          params: { changeKg30d: input.changeKg30d, expected30d },
        }
      : {
          ruleId: "weight.trend_off_track",
          version: 1,
          severity: "info",
          messageAr: "اتجاه وزنك بعيد عن هدفك حالياً",
          messageEn: "Your weight trend is off your goal right now",
          params: { changeKg30d: input.changeKg30d, expected30d },
        },
  );
  return messages;
}
