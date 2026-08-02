# Calculation Policy Versioning (operational view)

Companion to `docs/calculations.md` (the formula itself). This covers how
policy changes are managed operationally without breaking historical
calorie/macro estimates.

## The rule

`calculation_snapshots` (one row per computed estimate) stores both the
`policyId` that produced it and a full copy of `inputs`/`outputs`. A
snapshot's numbers **never change** after creation, regardless of what
happens to `calculation_policies` afterward — a user's calorie history is a
timeline of point-in-time calculations, not a live-recomputed value.

## Creating a new policy version

`POST /admin/calc-policies` with an existing `key` auto-increments
`version` (never edits an existing version's `config` in place — versions
are immutable once created, matching the food-version immutability pattern
elsewhere in the platform). Passing `activate: true` deactivates the prior
active version for that `key` in the same transaction — enforced further by
a partial unique index (`WHERE is_active`) as the database-level backstop
against ever having two active versions of the same policy key.

## What changes when a new version activates

Only **future** calculations. `POST /me/calc/estimate` always reads
`calculationPolicy.findFirst({ where: { key: 'mifflin_st_jeor', isActive:
true } })` at request time — so activating a new policy version changes
what the *next* estimate a user requests will produce, but every previously
computed `calculation_snapshots` row (and the diary/summary data built on
top of the *macro targets it implied*) is untouched.

## Config shape

`config` is an opaque JSONB blob validated at the domain layer, not the
database — `packages/domain/src/calc/types.ts`'s `CalcPolicyConfig` is the
authoritative shape (activity multipliers, guardrails, macro split
defaults, rounding rules, disclaimers). The admin API accepts any
`Record<string, unknown>` and lets the calc engine fail loudly
(`CalcValidationError`) at estimate time if a policy is malformed — there is
deliberately no schema validation at policy-creation time, since the engine
itself is the single source of truth for what a valid config looks like and
duplicating that validation would drift.

## Testing implication

`packages/domain/src/calc/engine.spec.ts` tests the engine against a fixed
policy object, independent of the database — policy *version management* is
tested at the integration level (see the "manages calculation policy
versions" case in `apps/api/test/admin.integration.spec.ts`, and the "keeps
historical snapshots stable when the policy changes" case in
`apps/api/test/profile-calc.integration.spec.ts`).
