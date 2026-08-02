/**
 * Future AI meal-plan boundary — contracts only, NO provider is called in this
 * phase. A provider implements MealPlanProviderPort; the disabled mock ships
 * so wiring is proven without any AI dependency. See docs/adr/0004.
 */

export interface MealPlanConstraints {
  targetKcal: number;
  macroTargets?: { proteinG?: number; carbsG?: number; fatG?: number };
  dietaryPrefs: string[];
  allergies: string[];
  excludedFoodIds: string[];
  mealsPerDay: number;
  locale: string;
}

/** Candidate items the provider may plan with — released foods/recipes only. */
export interface MealPlanCandidate {
  kind: "food" | "recipe";
  id: string;
  nameAr: string;
  nameEn: string;
  nutrientsPerServing: Record<string, number>;
  defaultServingGrams: number | null;
}

export interface GenerateMealPlanRequest {
  userId: string;
  days: number;
  constraints: MealPlanConstraints;
  candidates: MealPlanCandidate[];
  likedSuggestionIds: string[];
  rejectedSuggestionIds: string[];
}

export interface PlannedMealItem {
  kind: "food" | "recipe";
  id: string;
  quantity: number;
  unit: string;
  /** Explainable totals — the provider must show its arithmetic. */
  nutrients: Record<string, number>;
}

export interface PlannedDay {
  dayIndex: number;
  slots: Array<{ mealSlot: string; items: PlannedMealItem[] }>;
  totals: Record<string, number>;
}

export interface GeneratedMealPlan {
  /** draft until a human activates it — plans are always human-editable. */
  status: "draft";
  days: PlannedDay[];
  providerName: string;
  explanation: string[];
}

export interface ReviseMealPlanRequest {
  plan: GeneratedMealPlan;
  instructionsText: string;
  rejectedSuggestionIds: string[];
}

export interface MealPlanProviderPort {
  readonly name: string;
  readonly isEnabled: boolean;
  generatePlan(request: GenerateMealPlanRequest): Promise<GeneratedMealPlan>;
  revisePlan(request: ReviseMealPlanRequest): Promise<GeneratedMealPlan>;
}

export const MEAL_PLAN_PROVIDER = "MEAL_PLAN_PROVIDER";

/** Disabled placeholder proving the seam; real providers replace this token. */
export class MockMealPlanProvider implements MealPlanProviderPort {
  readonly name = "mock";
  readonly isEnabled = false;

  generatePlan(_request: GenerateMealPlanRequest): Promise<GeneratedMealPlan> {
    return Promise.reject(new Error("meal-plan provider is not enabled in this phase"));
  }

  revisePlan(_request: ReviseMealPlanRequest): Promise<GeneratedMealPlan> {
    return Promise.reject(new Error("meal-plan provider is not enabled in this phase"));
  }
}
