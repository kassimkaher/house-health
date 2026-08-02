# ADR 0004: Future AI meal-plan boundary

Status: accepted · Date: 2026-08-02

## Context

The platform must be ready for a future AI-generated meal-plan feature without
calling any AI provider in this phase, and without coupling the domain to a
specific vendor.

## Decision

`packages/contracts/src/ai.ts` defines the full contract surface:
`MealPlanProviderPort` (`generatePlan`, `revisePlan`), `GenerateMealPlanRequest`
(constraints, candidate foods/recipes drawn only from the active release,
liked/rejected suggestion ids), and `GeneratedMealPlan` (always `status:
"draft"`, per-day/per-slot items with explainable per-item nutrient totals).

`MockMealPlanProvider` implements the port with `isEnabled = false` and both
methods reject — it exists to prove the DI seam compiles and can be swapped
for a real provider later, not to produce output. No route calls it in this
phase; there is no AI-generation endpoint yet, only the contracts and the
disabled adapter.

## Extending later

A real provider:
1. Implements `MealPlanProviderPort` against a chosen model/API in a new
   package (e.g. `packages/ai-mealplan`).
2. Is bound to the `MEAL_PLAN_PROVIDER` token in `apps/api`'s DI container.
3. Candidates passed to `generatePlan` must come from `food_versions WHERE
   is_in_active_release` (or the user's own recipes) — the provider never
   invents foods outside the structured dataset.
4. Generated plans stay `status: "draft"` until a human edits/activates them
   into real diary entries — activation reuses the existing
   `NutritionSnapshotService`/diary-entry creation path, so snapshot
   immutability guarantees are inherited for free.

## Consequences

Zero AI dependency risk in this phase; the extension point is typed and
testable today (see the disabled-provider assertion in
`apps/api/test/summary.integration.spec.ts`-adjacent unit coverage).
