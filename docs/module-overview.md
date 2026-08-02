# Module Overview

High-level map of what lives where. See `docs/architecture/erd.md` for the
data model and `docs/adr/` for the reasoning behind the non-obvious choices.

## Packages (framework-light, shared)

| Package | Contains |
|---|---|
| `packages/domain` | Pure business logic, zero Nest/Prisma/BullMQ deps: calorie calc engine (`calc/`), nutrition snapshot builder + unit resolution (`nutrition/`), guidance rules (`guidance/`), reminder scheduling (`reminders/schedule.ts`). Enforced framework-free by ESLint boundaries. |
| `packages/database` | Prisma schema, migrations (including hand-written SQL for generated columns/indexes/functions), seeds, the shared `prisma`/`withTx` client export. |
| `packages/contracts` | Zod schemas + inferred DTO types for every API payload, the machine-readable `ERROR_CODES` registry, the shared `ZodValidationPipe`. Single source of truth consumed by both `apps/api` and `apps/admin-web`. |
| `packages/auth` | Password hashing, JWT sign/verify, refresh-token primitives, the `Permission`/`Role`/`PERMISSION_MAP`, Nest guards (`JwtAuthGuard`, `PermissionsGuard`, `CsrfGuard`), cookie helpers for admin-web. |
| `packages/storage` | `ObjectStorage` port + MinIO/S3 adapter (presigned URLs, bucket management, health ping). |
| `packages/notifications` | `EmailPort`/`PushPort` + log providers (dev-safe defaults) and the FCM seam. |
| `packages/config` | Typed, validated env loading (`loadConfig()`), fails fast with readable errors. |
| `packages/pipeline` | Import runner (chunked/checkpointed), dataset release lifecycle (`ReleaseService`), reminder sweeper, BullMQ queue/job-id constants — the domain layer for background work, consumed by both `apps/api` (producers) and `apps/worker` (processors). |
| `packages/testing` | `createTestApp()`, table truncation, recording email provider — integration test infrastructure. |

## apps/api (NestJS, public + admin REST)

| Module | Responsibility |
|---|---|
| `auth/` | Registration, verification, login, refresh rotation, sessions, password reset, Google OIDC, audit writes. |
| `profile/` | User profile CRUD, weight history, calorie/macro calculation endpoints. |
| `catalog/` | Admin food/nutrient/category/brand/portion/barcode CRUD, review-state machine, duplicate detection + merge. |
| `foods/` | Public search + detail — reads only the active dataset release. |
| `pipeline-admin/` | Admin import job + dataset release endpoints (thin controllers over `packages/pipeline`). |
| `consumption/` | Recipes, meal groups, diary entries, favorites, recents — all snapshot-immutable where nutrition is involved. |
| `reminders/` | Reminder CRUD, delivery log read endpoint. |
| `summary/` | Deterministic daily/weekly summaries, guidance rules, aggregated `/home` payload. |
| `admin-users/` | User search, role management, suspend/reactivate, soft delete. |
| `admin-ops/` | Audit log query, BullMQ job monitoring, calc-policy admin, system overview/media status. |
| `infra/` | Prisma/Redis/Storage/Queue Nest wiring, rate-limit storage, config loading. |
| `health/` | Liveness + readiness (Postgres/Redis/MinIO) checks. |

## apps/worker (NestJS application context, no HTTP)

Registers BullMQ **processors only** (the api registers producers only):
import execution, dataset release building, the once-a-minute reminder
sweeper + per-delivery dispatch. Exposes a minimal `/health/live` +
`/metrics`-shaped HTTP listener for compose healthchecks.

## apps/admin-web (Next.js)

Cookie-authenticated admin dashboard consuming only the `apps/api` admin
endpoints (`/admin/*`) — see `docs/admin-operations.md` for what each screen
does and `docs/security-privacy.md` for the CSRF mechanism it relies on.

## Cross-cutting conventions

- **Domain purity**: `packages/domain` never imports Nest/Prisma/BullMQ;
  apps wire domain services to infrastructure, not the other way around.
- **Snapshot immutability**: anywhere nutrition is logged (diary, recipe
  ingredients), the write path goes through `packages/domain`'s snapshot
  builder exclusively — no controller/service computes nutrient totals by
  hand.
- **Release boundary**: public reads (`foods/`, search, barcode) never touch
  the editorial `foods`/`food_nutrients`/etc. tables — only
  `food_versions WHERE is_in_active_release`.
- **Audit-by-default**: every admin mutation writes to the append-only
  `audit_log` via `AuditService`.
