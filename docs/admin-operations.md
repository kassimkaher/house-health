# Admin Operations Guide

Audience: data managers, nutrition reviewers, support admins, and super
admins operating the Health House platform day to day. All admin endpoints
live under `/api/v1/admin/*` and require an authenticated session carrying
the listed permission (see `packages/auth/src/permissions.ts` for the full
role→permission map).

## Roles at a glance

| Role | Can do |
|---|---|
| `user` | Own data only — no admin access. |
| `nutrition_reviewer` | Read the catalog; move foods through review states. |
| `data_manager` | Full catalog CRUD, run imports, publish/rollback releases, merge duplicates, view job queues. |
| `support_admin` | View/search users, suspend/reactivate accounts, read the audit log. Cannot change roles or hard-manage users. |
| `super_admin` | Everything, including role changes and account deletion. |

## User management

`GET /admin/users` (search by email/status/role, cursor-paginated) →
`GET /admin/users/:id` for detail (includes active session count).

- **Suspend** (`POST /admin/users/:id/suspend`, `support_admin`+) immediately
  revokes every active session — the user is logged out everywhere within
  the request, not on next token expiry (their session ids are pushed onto
  the Redis denylist synchronously).
- **Reactivate** (`POST /admin/users/:id/reactivate`) restores `active`
  status; the user must log in again.
- **Role changes** (`POST /admin/users/:id/roles`, `super_admin` only)
  replace the full role set. A super_admin cannot strip their own
  `super_admin` role — this is a deliberate lockout guard, not a bug; have
  another super_admin do it if a role change to your own account is needed.
- **Soft delete** (`POST /admin/users/:id/delete`, `super_admin` only) sets
  `status=deleted` and `deletedAt`, revokes all sessions. The row is
  retained for audit/compliance — this is not a hard delete. Self-deletion
  is blocked the same way self-suspension is.

## Food catalog

Full CRUD lives under `/admin/catalog/foods`. Editing an existing food
requires the `If-Match: <rowVersion>` header (optimistic concurrency) — fetch
the current record, echo its `rowVersion`, or expect a `409
conflict.version` response if someone else edited it first.

**Review states**: `imported → normalized → needs_review → verified |
rejected`; anything can move to `archived`; `rejected`/`archived` can be
revived to `needs_review`. Editing a `verified` food automatically drops it
back to `needs_review` — verification is not permanent against edits.
Rejecting or archiving a food deactivates its barcodes in the same
transaction, freeing them for reassignment.

**Nutrients**: `POST /admin/catalog/foods/:id/nutrients` replaces the full
set (not a partial merge) and rebuilds the denormalized per-100g map used by
admin list views and the release builder.

**Aliases, barcodes, portions**: additive endpoints under the food's
sub-resources. Duplicate aliases (by normalized form) are silently no-ops;
barcodes are globally unique among *active* assignments — attaching an
already-active code to a different food returns `409
catalog.barcode_taken`.

## Duplicate review & merge

`GET /admin/catalog/duplicates?threshold=0.6` ranks candidate pairs by
trigram name similarity over the editorial `foods` table (never the
published release). Review pairs, then:

`POST /admin/catalog/duplicates/merge` with `{sourceFoodId, targetFoodId}`:
- Copies the source's aliases (dedup-safe) and portions (skips
  same-label duplicates) onto the target.
- Reassigns the source's *active* barcodes to the target.
- Reassigns source-record provenance where it doesn't collide with an
  existing `(provider, externalId)` pair on the target; colliding records
  stay on the source.
- Archives the source (`reviewStatus=archived`,
  `publicationStatus=deprecated`) — **never hard-deleted**. Historical diary
  entries and recipe ingredients that reference the source food keep working
  because their nutrition is already snapshotted; the source simply won't
  appear in future dataset releases.

## Import pipeline

1. `POST /admin/imports` (multipart, field `file`, plus `providerKey`,
   `mode`: `create_only`/`update_existing`/`upsert`, `isDryRun`). An
   `Idempotency-Key` header makes retried uploads safe.
2. Poll `GET /admin/imports/:id` for status
   (`queued→validating→parsing→normalizing→matching→importing→completed
   |partially_completed|failed|cancelled`) and `stats`.
3. `GET /admin/imports/:id/errors.csv` downloads row-level errors for any
   row that failed validation — fix the source file and re-upload, or use
   `POST /admin/imports/:id/retry` to resume a failed/partial job from its
   last committed checkpoint (no duplicate rows on retry).
4. `POST /admin/imports/:id/cancel` requests cancellation; honored between
   chunks, not mid-chunk.

## Dataset releases

1. `POST /admin/releases {version, notes?}` queues an async build (worker
   job) from every `verified`, non-deleted food. Building requires at least
   one verified food.
2. `GET /admin/releases/:id/compare/:otherId` diffs two releases (added /
   removed / changed / unchanged food ids).
3. `POST /admin/releases/:id/publish` atomically activates the release —
   single advisory-locked transaction, safe against concurrent publishes.
4. `POST /admin/releases/:id/rollback` re-publishes a prior release; the
   release being replaced is marked `rolled_back` (not deleted — its
   `FoodVersion` rows and provenance remain queryable).
5. `POST /admin/releases/:id/archive` — only for inactive releases.

Publishing is what the public `/foods/search` and `/foods/:id` endpoints
read from (`WHERE is_in_active_release`); nothing else in the editorial
catalog affects public traffic until a release is published.

## Calculation policies

`GET/POST /admin/calc-policies` — creating a new policy version for an
existing `key` auto-increments `version`; passing `activate: true`
deactivates the prior active version for that key in the same transaction.
Historical `calculation_snapshots` keep referencing the policy version that
produced them, so past estimates never silently change when a new policy is
activated.

## Jobs & system monitoring

- `GET /admin/jobs/summary` — BullMQ job counts (waiting/active/delayed/
  completed/failed) for the imports, catalog, and reminders queues.
- `GET /admin/jobs/failed` — the 20 most recent failed jobs per queue with
  their failure reason.
- `GET /admin/system/overview` — dashboard landing counts (users, catalog
  size, needs-review backlog, active release, recent imports, pending media).
- `GET /admin/system/media` — recent media asset upload status.
- `GET /health/ready` — Postgres/Redis/MinIO connectivity, each with a 2s
  timeout; returns 503 if any dependency is down. Used by the deploy
  healthcheck, not typically browsed directly.

## Audit log

`GET /admin/audit` (filter by `entityType`, `entityId`, `actorId`, `action`;
cursor-paginated on `id`, newest first). The underlying table is
append-only — the database rejects `UPDATE`/`DELETE` at the trigger level
regardless of application-layer bugs. Every mutating admin action in this
guide writes an audit row; use this endpoint to answer "who did what, when."

## Admin-web authentication

The admin dashboard authenticates via httpOnly cookies rather than bearer
tokens: `POST /auth/login?client=web` sets `hh_access`, `hh_refresh`
(httpOnly), and `hh_csrf` (readable, for the double-submit pattern). Every
mutating request from the browser must echo the `hh_csrf` cookie value in an
`x-csrf-token` header, or the API returns `403 auth.forbidden` — this is
enforced independently of the permission system and protects against
cross-site request forgery specifically; it does not apply to bearer-token
(mobile/API) clients.
