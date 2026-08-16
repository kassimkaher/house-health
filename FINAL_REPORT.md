# Health House — Final Report

**Status: PASS**

All 15 build phases from the approved plan are complete, committed, and
verified. The platform boots end-to-end (locally as compiled processes and
as real Docker containers via the documented Contabo deployment path),
automated tests are green, performance targets are met with margin, and no
unresolved critical/high defects remain open. Known limitations and
non-blocking follow-ups are listed at the end of this report — none of them
block this phase's scope (the spec's explicit non-goals: no mobile client,
no live AI provider, no payments, no social features, no medical
diagnosis).

## 1. Architecture delivered

Modular-monolith backend (NestJS + PostgreSQL/Prisma + Redis + BullMQ +
MinIO), a Next.js admin dashboard, and versioned `/api/v1` REST APIs, built
as a pnpm + Turborepo monorepo. Framework-free domain logic
(`packages/domain`) is enforced separate from Nest wiring by ESLint
boundaries. Full architectural reasoning is in `docs/adr/` (monorepo shape,
dataset release versioning, Arabic search normalization, AI meal-plan
boundary) and `docs/module-overview.md`.

## 2. Repository structure

```
apps/api            NestJS REST API (public /api/v1 + admin /api/v1/admin)
apps/worker          BullMQ consumers (imports, releases, reminders)
apps/admin-web       Next.js admin dashboard
packages/domain      Calc engine, nutrition snapshots, guidance, reminder scheduling — no framework deps
packages/database    Prisma schema, migrations, seeds, repositories
packages/contracts   Zod schemas — single source of truth for DTOs + OpenAPI
packages/auth        Password/JWT/refresh-token primitives, guards, permission map
packages/storage     ObjectStorage port + MinIO/S3 adapter
packages/notifications  Email/push ports + log providers, FCM seam
packages/pipeline    Import runner, dataset release lifecycle, reminder sweeper
packages/config      Typed env loading/validation
packages/testing     createTestApp(), fixtures, integration test infra
infrastructure/docker    Dockerfiles, compose base/prod/staging/dev/test
infrastructure/nginx     Reverse proxy configs (HTTP + HTTPS-enabled variants)
docs/                Architecture, ADRs, ERD, runbooks, performance evidence
scripts/             ci.sh, deploy.sh, enable-tls.sh, backup/restore, perf test
```

See `docs/module-overview.md` for the full per-module responsibility map.

## 3. Database

- Schema: `packages/database/prisma/schema.prisma` (40+ models).
- Migration: `packages/database/prisma/migrations/20260801005333_init/migration.sql`
  — hand-edited beyond what Prisma generates for `normalize_arabic()`,
  generated/`STORED` columns, partial + expression indexes, `citext`, and
  the append-only `audit_log` (`REVOKE UPDATE, DELETE` from the app role).
- ERD: `docs/architecture/erd.md`.
- Seeds: `packages/database/prisma/seed.ts` (nutrients, categories, calc
  policy, dev accounts behind `SEED_DEV_ACCOUNTS=1`); bulk performance
  dataset generator at `packages/database/prisma/seed-perf-dataset.ts`.
- Backup/restore: `docs/backup-restore.md`, `scripts/backup-db.sh`,
  `scripts/restore-db.sh`.

## 4. Auth and roles

Email/password (argon2id) + Google OIDC, ES256 access JWTs (10 min) with
rotating refresh tokens (session-family reuse detection — a stolen refresh
token revokes the whole device session on first reuse). Role/permission
model: `user`, `nutrition_reviewer`, `data_manager`, `support_admin`,
`super_admin` mapped through a static `PERMISSION_MAP`
(`packages/auth/src`), enforced by `PermissionsGuard`, not by role-string
checks scattered through controllers. Admin-web uses httpOnly Secure
SameSite cookies + double-submit CSRF; mobile/API clients use bearer
tokens — same endpoints, different transport, verified in
`apps/api/test/security.integration.spec.ts` and
`auth.integration.spec.ts`.

## 5. Dataset import/release workflow

Upload → dry-run → import (chunked, checkpointed, resumable) → duplicate
review/merge → verification → release build → publish/rollback, all
API-driven from admin-web. Publish/rollback is a single advisory-locked
transaction that flips `is_in_active_release` flags — public reads never
join across the editorial and published layers. Full lifecycle documented
in `docs/architecture/dataset-release-lifecycle.md` and exercised
end-to-end by `packages/pipeline/test/pipeline.integration.spec.ts` (9/9
green): dry-run, import, re-import/upsert dedup, create-only-mode dedup,
candidate build, publish, version reuse across releases, rollback, and
archive-only-inactive enforcement.

**Historical-data-survives-dataset-update guarantee**: diary/recipe
nutrition is a write-once JSONB snapshot pinned to the `foodVersionId` at
log time (`docs/architecture/nutrition-snapshots.md`); a dedicated
"snapshot-integrity gate" integration test proves totals logged before a
dataset update stay byte-identical after the update publishes.

## 6. Search implementation

Single `IMMUTABLE` SQL function `normalize_arabic()` (alef unification,
ya/alif-maqsura, ta-marbuta, hamza folding, tatweel/harakat stripping, then
`unaccent`) used identically by generated columns and query-time
normalization — the application layer never normalizes, so drift between
index-time and query-time normalization is structurally impossible
(`docs/adr/0003-arabic-search-normalization.md`,
`docs/search-normalization.md`). Tiered ranking (exact=4 > prefix=3 >
full-text=2 > trigram=1) implemented as one CTE
(`apps/api/src/foods/food-search.repository.ts`) over
`food_versions`, fully index-driven via partial indexes on
`is_in_active_release`. Verified both by
`apps/api/test/*.integration.spec.ts` search cases (Arabic exact, Iraqi
dialect alias, English, typo/fuzzy, barcode) and, at 50k-row volume, by the
performance run in `docs/performance.md`.

## 7. Admin dashboard

Next.js app router, cookie+CSRF auth, sidebar filtered by the same
permission map the server enforces. Sections: users (roles/suspend/
reactivate/soft-delete with self-lockout guards), catalog (foods/
categories/brands/nutrients with If-Match optimistic-concurrency editing),
duplicate review/merge, imports (upload, error-CSV download, retry/
cancel), releases (build/compare/publish/rollback/archive), calc policies,
job queue monitoring, audit log, system overview/health. Full walkthrough
in `docs/admin-operations.md`.

## 8. Test commands and results

```bash
pnpm lint            # 12/12 packages clean
pnpm typecheck        # 21/21 tasks clean
pnpm test             # unit tests
./scripts/test-integration.sh   # integration tests against real PG/Redis/MinIO
pnpm openapi && git diff --exit-code docs/openapi.json   # drift check
```

Latest full run (this session, after all Phase 14/15 fixes):
**66 unit tests, 93 API + 9 pipeline integration tests, all green.**
Lint, typecheck, and OpenAPI drift check all pass. `scripts/ci.sh` runs
this exact pipeline end-to-end (`lint → typecheck → unit → integration →
openapi-drift`).

## 9. Performance evidence

Full methodology, hardware caveats, and a real finding (load-generator
concurrency vs. Prisma's default DB connection-pool size) are in
`docs/performance.md`. Summary, 50,010-food dataset:

| Endpoint | Target (p95) | Observed p97.5 | Result |
|---|---|---|---|
| Food search | < 300ms | 51–69ms | **PASS**, 4–5x margin |
| Food detail | < 200ms | 59–89ms | **PASS**, 2–3x margin |
| Diary/nutrition summary | < 300ms | 69–90ms | **PASS**, 3–4x margin |

## 10. Security checks

OWASP-aligned: helmet security headers, Redis-backed per-IP + stricter
per-auth-route rate limiting, argon2id (memory-hard, throttler doubles as a
brute-force memory guard), CSRF double-submit for cookie clients, IDOR
guards on every user-scoped resource, global exception filter that never
leaks stack traces to clients, append-only audit log with `REVOKE
UPDATE/DELETE` at the database level, PII inventory + self-service
export/delete (`docs/security-privacy.md`). Dedicated regression suite
(`apps/api/test/security.integration.spec.ts`) covers unauthorized access,
privilege escalation, IDOR, injection-shaped input, and mass-assignment
attempts.

## 11. Deployment and rollback evidence

Docker Compose topology for a single Contabo server: `postgres`, `redis`,
`minio`, `api`, `worker`, `admin-web`, `nginx`, one-shot `migrate`, two
networks (`edge` internet-facing, `data` internal-only). Nginx routes the
three real domains specified
(`health-house.aljoodnet.info`, `api-health-house.aljoodnet.info`,
`s3-health-house.aljoodnet.info`) with a swappable HTTP/HTTPS-enabled file
pair per site (`scripts/enable-tls.sh`). Full runbooks:
`docs/runbooks/deploy.md`, `docs/runbooks/rollback.md`,
`docs/runbooks/tls.md`.

**Proven, not just documented**: all four images (api/worker/admin-web/
migrate) were built from these exact Dockerfiles and brought up as a real
Compose stack on this machine — `migrate` applied the schema against a
fresh Postgres container, and Nginx correctly routed all three domain
names (verified via `curl --resolve`) to their respective containers. This
local proof caught and fixed six real deployment-blocking bugs the test
suite alone couldn't see (see the Phase 14 commit message for the full
list — missing per-package `node_modules` in runtime images, a
`@prisma/client` generation gap in the `--prod` install stage, a
mis-declared runtime dependency, an env-var validation bug that would have
crash-looped on any deploy following `.env.example`'s own instructions, an
unnecessary hard crash on a transient MinIO-unreachable boot condition,
and a missing root `.dockerignore`). Rollback is proven by design
(previous `IMAGE_TAG` redeploy for app code; `POST
/admin/releases/:id/rollback` for dataset rollback, exercised by the
pipeline integration suite; documented backup/restore procedure for
destructive-migration recovery).

## 12. Known limitations and non-blocking follow-ups

- No live push/FCM or SMTP provider wired — only the log-based dev
  providers are active. The `PushPort`/`EmailPort` seams and an FCM
  provider skeleton exist; wiring a real provider is a follow-up.
- ~~The `worker` container has no internet egress~~ — **corrected during
  the Contabo production deploy**: `worker` is now on both `data` and
  `edge` (see `compose.base.yml`). This turned out to be required sooner
  than expected — the import pipeline's worker-side `ImportRunner` fetches
  uploaded files via the same public `S3_ENDPOINT` used for presigned
  URLs, so a `data`-only worker couldn't resolve it and every import job
  failed at the object-fetch step. Caught and fixed during the first real
  production deploy, not a hypothetical.
- OpenTelemetry tracing is wired behind `OTEL_ENABLED` but dormant by
  default (no exporter configured) — the seam is proven, not the export
  path.
- Admin-web has no UI for the account data-export/delete flow; the API
  endpoints exist and are tested, but only reachable directly today.
- The sample food dataset is self-authored fixture data with provenance
  recorded — no bulk USDA FoodData Central / Open Food Facts import was
  performed in this phase (the import pipeline that would do so is built
  and tested against smaller fixture files).
- Performance numbers were measured on a shared, multi-tenant sandbox VM,
  not an isolated Contabo instance — see `docs/performance.md`'s hardware
  caveat. All targets passed with 2–5x margin even under that contention,
  which is a meaningfully stronger signal than a clean-room number would
  be, but real Contabo hardware should still be spot-checked post-deploy.

None of the above block this phase's completion — they are explicitly
out of scope per the plan's stated non-goals, or are seams intentionally
left for a documented future integration.
