# Handover — Health House

This document is the entry point for whoever takes ownership of this
codebase next — a new engineer, a team, or you-in-six-months. It's
oriented toward "how do I get productive and not break anything," not
toward reporting completion (`FINAL_REPORT.md` is that document).

## Status

**PASS.** All 15 planned build phases are complete, committed on `main`,
and verified: automated tests green, performance targets met, the deploy
path proven end-to-end on this machine. See `FINAL_REPORT.md` for the full
walkthrough and `docs/performance.md` for load-test evidence. Nothing here
is a prototype — treat it as production code, not a scaffold to redo.

## Read this first (in order, ~20 minutes)

1. `README.md` — local dev setup. Get the stack running before reading
   further; everything else makes more sense with a running instance in
   front of you.
2. `docs/module-overview.md` — the architectural map: what lives where and
   why (framework-free domain layer, contracts-as-single-source-of-truth,
   the api/worker producer/consumer split).
3. `FINAL_REPORT.md` — what was actually delivered, with pointers into the
   deeper docs for each area (auth, dataset lifecycle, search, admin,
   security, deployment).
4. `docs/go-live-checklist.md` — **read before deploying to real
   production hardware.** Everything proven so far used placeholder
   secrets and no real DNS; this lists exactly what a real cutover needs.

## Document index

Everything under `docs/` was written to be read standalone, not just as
supporting material for the final report. Full map:

| Doc | Covers |
|---|---|
| `docs/module-overview.md` | Package/app responsibility map |
| `docs/architecture/erd.md` | Data model (mermaid ERD) |
| `docs/architecture/dataset-release-lifecycle.md` | Import → review → release → publish/rollback |
| `docs/architecture/nutrition-snapshots.md` | Why diary/recipe nutrition is immutable JSONB, not a live join |
| `docs/adr/0001-*` … `0004-*` | The four non-obvious architectural decisions, with rejected alternatives |
| `docs/api-overview.md` | REST surface summary (also see `docs/openapi.json`, the generated spec) |
| `docs/food-schema-spec.md`, `docs/import-template.md` | Editorial food schema + CSV/JSON import format |
| `docs/data-sources.md` | Provider/licensing registry for future bulk imports |
| `docs/search-normalization.md` | The `normalize_arabic()` policy, pinned by tests |
| `docs/calculations.md`, `docs/calculation-policy-versioning.md` | Mifflin–St Jeor engine + how to version it |
| `docs/admin-operations.md` | What every admin-web screen does |
| `docs/mobile-integration.md` | Contract for a future mobile client against these same APIs |
| `docs/security-privacy.md` | PII inventory, export/delete flow, threat notes |
| `docs/observability.md` | Logs/metrics/tracing/health-check reference |
| `docs/performance.md` | Load-test methodology + results |
| `docs/backup-restore.md` | Backup cron + restore-test procedure |
| `docs/runbooks/deploy.md` | Full first-deploy → TLS → upgrade → rollback walkthrough |
| `docs/runbooks/rollback.md` | Quick-reference incident version |
| `docs/runbooks/tls.md` | Certificate issuance + renewal |
| `docs/runbooks/backup-cron.md` | Scheduling the nightly backup |
| `docs/go-live-checklist.md` | **New** — concrete pre-production checklist (secrets, DNS, accounts) |

## Running the tests

```bash
pnpm lint          # 12/12 packages
pnpm typecheck     # 21/21 tasks
pnpm test          # unit tests (domain calc engine, normalization, guards, permissions)
./scripts/test-integration.sh   # spins up a real PG/Redis/MinIO, runs the full API+pipeline suite
pnpm openapi && git diff --exit-code docs/openapi.json   # fails if endpoints changed but docs weren't regenerated
```

`./scripts/ci.sh` runs all of the above in the order CI expects. As of the
last run: 66 unit tests, 93 API + 9 pipeline integration tests, all green.

## Deploying

Read `docs/go-live-checklist.md` first, then `docs/runbooks/deploy.md`.
Short version: `scripts/deploy.sh` builds the four images, runs migrations
as a one-shot job, brings up the stack, and polls `/health/ready`. Rollback
is redeploying a previous `IMAGE_TAG` (app code) or `POST
/admin/releases/:id/rollback` (bad dataset) — never a database rollback
unless a destructive migration genuinely shipped, in which case
`docs/backup-restore.md` is the only safe path.

## Where to look when something's broken

- `GET /health/live` — process is up, nothing more.
- `GET /health/ready` — Postgres/Redis/MinIO checks; **this is the honest
  signal.** A `storage: error` here before TLS is issued on a fresh deploy
  is expected (see `docs/runbooks/deploy.md`'s "First deploy" section) —
  everything else should read `ok`.
- `GET /metrics` (internal-only via nginx) — prom-client default + custom
  metrics.
- Structured JSON logs (pino) — every request carries an `x-request-id`
  that's echoed in the response header and correlated through to any
  BullMQ job it enqueues; grep on that id to follow one request end-to-end
  across `api` and `worker` container logs.
- `docs/admin-operations.md`'s "system overview" screen surfaces job-queue
  depth and recent audit-log entries without touching a terminal.

### Gotchas discovered during the build (worth knowing before you hit them again)

These were real bugs, all fixed and covered by the current test/proof
suite — listed here so a future refactor doesn't reintroduce them silently:

- **`ts-jest` bypasses Node's real module resolution.** A shared package
  can pass every test and typecheck cleanly while still being unbootable
  as a compiled `node dist/main.js` process (missing `dist/` output,
  missing per-package `node_modules` in a Docker runtime stage, a
  runtime dependency mis-declared as a `devDependency`). If you add a new
  `packages/*` workspace, verify it survives a **real Docker build**, not
  just `pnpm test`.
- **Docker Compose sets blank env vars to `""`, not unset.** Any Zod
  `.optional()` schema field must explicitly treat `""` as absent (see
  `packages/config/src/config.ts`'s `optionalString()` helper) or a
  deployer following `.env.example`'s own "leave blank to disable"
  instructions will crash the app at boot.
- **`@prisma/client`'s generated output is tied to the exact
  `node_modules` instance it was generated into.** A multi-stage Docker
  build with a separate `--prod`-only install stage needs its own `prisma
  generate` in that stage — copying the `build` stage's generated client
  silently doesn't work across the stage boundary.
- **Prisma's default connection pool (`num_cpus * 2 + 1`) can be smaller
  than your load-test/production concurrency.** Manifests as a fat p99
  tail on an otherwise-fast endpoint, easy to misdiagnose as an app bug.
  See `docs/performance.md`'s methodology section.
- **BullMQ rejects custom job ids containing a single `:`** (it reserves
  colons for its own legacy repeatable-job id format — a job id must
  either have zero colons or split into exactly 3 parts). Three of the
  four deterministic job-id helpers in `packages/pipeline/src/queues.ts`
  used a single colon and threw `Custom Id cannot contain :` the moment a
  real BullMQ+Redis instance processed them; the fourth
  (`reminderDispatch`) only happened to survive because it has exactly two
  colons. No integration test caught this because none of them exercise
  the real HTTP import endpoint's `queue.add()` call — the pipeline test
  suite calls `ImportRunner`/`ReleaseService` directly. Fixed by switching
  every job-id helper to `.`-delimiters; found and fixed during the first
  real production deploy.
- **`worker` needs `edge` network access, not just `data`.** It was
  originally `data`-only (reasoned as "fine, it only needs Postgres/Redis/
  MinIO"), but `S3_ENDPOINT` is deliberately the *public* `s3.<domain>`
  hostname (so presigned URLs work for real clients) — and the import
  pipeline's worker-side file fetch uses that same single S3 client/
  endpoint. A `data`-only worker can't resolve or route to it, so every
  import job failed with `getaddrinfo ENOTFOUND`. Fixed in
  `compose.base.yml` (worker is now `[data, edge]`) during the first
  production deploy — this benefits every deployment, not just this one.

## What's not done (and suggested order to pick it up)

Full list with reasoning in `FINAL_REPORT.md` §12. In priority order for a
team continuing this work:

1. **Wire a real email + push provider.** The `EmailPort`/`PushPort` seams
   and log-based dev providers are in place and tested against; swapping
   in real SMTP/FCM is bounded work. `worker` already has internet egress
   (`edge` network — added during the first production deploy, since the
   import pipeline needed it too; see the gotchas list below), so no
   network change is needed for this one.
2. **Bulk dataset import** (USDA FoodData Central / Open Food Facts). The
   import pipeline is built and tested against fixture files; this is
   "run it against a real source," not new engineering.
3. **Admin-web UI for the account export/delete flow.** The API endpoints
   exist and are tested; only the admin-web screen is missing.
4. **Turn on OpenTelemetry export** (`OTEL_ENABLED=true` +
   `OTEL_EXPORTER_OTLP_ENDPOINT`) once there's a collector to point it at.
5. Mobile client, against the same `/api/v1/*` surface documented in
   `docs/mobile-integration.md` — explicitly out of scope for this phase,
   not started.

## Ownership

_Fill in for your team: primary maintainer(s), on-call rotation if any,
where secrets are stored (see `docs/go-live-checklist.md`), escalation
path._
