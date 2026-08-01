# Calorie & Macro Calculations

Implementation: `packages/domain/src/calc/engine.ts` (pure, deterministic).
Policy config: `calculation_policies` table, seeded as `mifflin_st_jeor` v1.
Every computed result is persisted as an immutable `calculation_snapshots` row
(inputs + outputs + policy version) — historical plans never silently change
when policies are updated.

## Equation (policy `mifflin_st_jeor`, version 1)

BMR (Mifflin–St Jeor):

- male: `10·kg + 6.25·cm − 5·age + 5`
- female: `10·kg + 6.25·cm − 5·age − 161`

Age is computed from date of birth at calculation time (never stored as a
fixed number).

Maintenance (TDEE): `BMR × activity multiplier`

| Level | Multiplier |
|---|---|
| sedentary | 1.20 |
| light | 1.375 |
| moderate | 1.55 |
| active | 1.725 |
| very_active | 1.90 |

Goal delta: `rate(kg/week) × 7700 / 7` kcal/day, subtracted for `lose`,
added for `gain`, zero for `maintain` (default rate 0.5 kg/week when a goal is
set without a rate).

## Guardrails (v1 values — all configurable per policy version)

- Rate clamped to 1.0 kg/week.
- Daily deficit clamped to 1000 kcal; surplus to 500 kcal.
- Target never below 1200 kcal (female) / 1500 kcal (male).
- Age 18–100; height 50–280 cm; weight 20–<500 kg.

Every clamp emits a machine-readable warning code in the result — guardrail
interventions are never hidden. Validation failures throw field-level errors.

## Macros

Default split 30% protein / 40% carbs / 30% fat of target calories, converted
at 4/4/9 kcal per gram. Calories round to nearest 10; macros to 1 g.

## Output contract

`{ bmr, maintenanceKcal, targetKcal, appliedDeltaKcal, macros, warnings[],
explanation { equation, policyVersion, ageYears, activityMultiplier,
requestedRateKgPerWeek, appliedRateKgPerWeek, assumptions[], disclaimers[] } }`

Disclaimers include `estimates_not_medical_advice`; the platform presents
estimates, not medical guidance.

## Versioning rules

- Policy changes = new `calculation_policies` row (key, version+1); the old
  version stays for snapshot fidelity.
- Engine behavior changes that alter results for identical inputs also require
  a policy version bump.
- Boundary tests live in `packages/domain/src/calc/engine.spec.ts`.
