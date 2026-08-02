export * from "./calc/types";
export { ageYearsAt, calculateEnergyTargets, mifflinStJeorBmr } from "./calc/engine";
export {
  CALC_VERSION,
  CORE_NUTRIENT_KEYS,
  GramResolutionError,
  SNAPSHOT_SCHEMA_VERSION,
  buildNutritionSnapshot,
  resolveGrams,
  scaleNutrients,
  sumSnapshotNutrients,
  type GramResolutionInput,
  type NutritionSnapshot,
  type SnapshotBasis,
  type SnapshotSource,
} from "./nutrition/snapshot";
export { computeNextFireAt, type ReminderSchedule } from "./reminders/schedule";
export {
  GUIDANCE_THRESHOLDS,
  evaluateDailyGuidance,
  evaluateWeightGuidance,
  type DailyGuidanceInput,
  type GuidanceMessage,
  type WeightGuidanceInput,
} from "./guidance/rules";
