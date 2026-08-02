# Performance Test Results

## Summary

All three targets from the spec pass with wide margin on this test setup:

| Endpoint | Target (p95) | Observed p97.5 | Observed p99 | Result |
|---|---|---|---|---|
| Food search (`GET /foods/search`) | < 300ms | 51–69ms | 62–91ms | **PASS** (4–5x margin) |
| Food detail (`GET /foods/:idOrSlug`) | < 200ms | 59–89ms | 73–118ms | **PASS** (2–3x margin) |
| Diary day summary (`GET /diary/day/:date`, `GET /summary/daily/:date`) | < 300ms | 69–90ms | 94–116ms | **PASS** (3–4x margin) |

autocannon doesn't expose a plain p95 bucket — `p97_5` (its nearest reported
percentile) is used as a slightly stricter stand-in throughout this report,
so these numbers are a conservative read against the spec's p95 targets.

## Methodology

**Dataset**: 50,010 foods (50,000 procedurally generated + 10 curated
"anchor" foods with real Iraqi-dialect aliases) loaded directly into
`foods` + `food_versions` + one active `dataset_release` via
`packages/database/prisma/seed-perf-dataset.ts`. This bypasses the
editorial import pipeline (already correctness-tested by
`packages/pipeline/test/pipeline.integration.spec.ts`, 9/9 green) and writes
straight to the read-optimized, search-ready table in ~35 seconds — the
goal here is exercising query/index performance at realistic volume, not
re-testing the import pipeline's correctness. `aliases_norm` is computed via
the same `normalize_arabic()` SQL function used at query time, so the
generated/indexed columns (`name_ar_norm`, `search_tsv`, trigram indexes,
etc.) are byte-for-byte what a real release publish would produce. Verified
directly: the Iraqi-dialect alias "تمن" (timman) correctly matches "رز بسمتي"
(Basmati rice) at tier 4 (exact alias match) before any load testing began.

**Server**: `apps/api` built and run as a compiled process
(`node apps/api/dist/main.js`, not `nest start`/webpack dev mode) against
the persistent dev Postgres/Redis/MinIO containers
(`infrastructure/docker/compose.dev.yml`), with `NODE_ENV=test` — this
relaxes the `@nestjs/throttler` "general" zone from 120 req/60s to
100,000 req/60s, matching exactly how the repo's own integration test suite
runs (see `apps/api/src/app.module.ts`); it is not a change to production
defaults.

**Load generator**: [autocannon](https://github.com/mcollina/autocannon)
(pure-Node, no external binary), 9 concurrent connections, 10s per target,
with a brief untimed warm-up pass and a 1.5s gap between targets (see
"methodology finding" below for why).

**Auth**: a real user was registered, verified (via the dev
`LogEmailProvider`'s console-logged verification link — no SMTP wired up in
this repo, by design), and logged in through the actual HTTP API; three
diary entries were logged for the current date through `POST
/diary/entries` so `/diary/day/:date` and `/summary/daily/:date` aggregate
real snapshot data rather than empty-state responses.

**Hardware**: shared multi-tenant sandbox VM, 4 vCPU (AMD EPYC), 7.8GB RAM,
Postgres 16.14 with default `shared_buffers=128MB` and `max_connections=100`
— **not** an isolated Contabo VPS, and other tenants' workloads were
observably running concurrently throughout this session (visible in Docker
build times elsewhere in this branch's history). Numbers here should be
read as a lower bound on what a dedicated Contabo instance would deliver,
not a hardware-calibrated production forecast.

### Methodology finding: match load-generator concurrency to the DB connection pool

The first two full-suite runs (at 20 concurrent HTTP connections) showed a
reproducible, large p99 outlier (multiple seconds) specifically on
low-total-request targets, while high-volume targets were unaffected.
Isolating the "food detail" target and re-running it alone at the same
concurrency reproduced clean numbers (p97.5 176ms) — ruling out a
per-endpoint defect. The actual cause: Prisma's default connection pool
size is `num_physical_cpus * 2 + 1` (9 on this 4-vCPU host), smaller than
the 20 concurrent HTTP connections the load generator was opening — so a
minority of requests queued waiting for a free DB connection, producing a
fine p50 but a fat p99 tail. Confirmed directly: re-running at 9 concurrent
connections (matching the pool size) eliminated the tail spike entirely and
*raised* throughput (226 rps vs. an erratic 48–307 rps across targets at 20
connections). All numbers in the summary table above are from the
concurrency-matched (9-connection) run.

This is a real, actionable tuning note for production, not a defect: size
`DATABASE_URL`'s connection pool (`?connection_limit=N`) relative to actual
expected concurrent request volume for the deployed server's CPU count,
or accept that sustained concurrency beyond the pool size will queue at the
database layer before it queues anywhere else.

## Reproducing

```bash
# 1. Seed the dataset (idempotent — safe to re-run; ~35s for 50k foods)
cd packages/database
DATABASE_URL="postgresql://hh:hh_dev_password@127.0.0.1:5433/health_house?schema=public" \
  DATASET_SIZE=50000 pnpm exec tsx prisma/seed-perf-dataset.ts

# 2. Build and boot the api as a compiled process, NODE_ENV=test
cd ../..
pnpm --filter @hh/api... build
NODE_ENV=test API_PORT=3100 \
  DATABASE_URL="postgresql://hh:hh_dev_password@127.0.0.1:5433/health_house?schema=public" \
  REDIS_URL="redis://127.0.0.1:6380" \
  S3_ENDPOINT="http://127.0.0.1:9100" S3_ACCESS_KEY="hh_minio" S3_SECRET_KEY="hh_dev_minio_password" \
  node apps/api/dist/main.js &

# 3. Register + verify + log in a test user (see the api's stdout for the
#    dev "=== DEV EMAIL ===" banner containing the verification link),
#    then log a couple of diary entries so summary endpoints have real data.

# 4. Run the load test
PERF_ACCESS_TOKEN="<accessToken from login>" PERF_CONNECTIONS=9 PERF_DURATION=10 \
  node scripts/perf-test.mjs
```

## Cleanup

The perf dataset is isolated by a `perf-` slug prefix and a dedicated
`perf-test` dataset release; re-running `seed-perf-dataset.ts` wipes and
regenerates it. To remove it entirely without reseeding:

```sql
DELETE FROM release_items WHERE release_id IN (SELECT id FROM dataset_releases WHERE version = 'perf-test');
DELETE FROM food_versions WHERE food_id IN (SELECT id FROM foods WHERE slug LIKE 'perf-%');
DELETE FROM dataset_releases WHERE version = 'perf-test';
DELETE FROM foods WHERE slug LIKE 'perf-%';
```
