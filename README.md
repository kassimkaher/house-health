# Health House — Nutrition & Calorie Platform

Arabic-first (Iraqi-dialect-aware) nutrition and calorie-tracking backend.
Modular monolith: NestJS + PostgreSQL + Prisma + Redis + BullMQ + MinIO,
with a Next.js admin dashboard, deployable via Docker Compose on a single
Contabo server.

See `docs/` for the full documentation set — this file covers local setup
only. Start with `docs/module-overview.md` for an architectural map and
`docs/admin-operations.md` for how to actually use the admin surface.

## Prerequisites

- **Node 22 LTS** via [nvm](https://github.com/nvm-sh/nvm) — the system
  Node on some hosts may be older; `.nvmrc` pins the version this repo
  requires. Never rely on a different Node for anything in this repo.
  ```bash
  nvm install && nvm use
  corepack enable pnpm
  ```
- **pnpm 9** (pinned via `packageManager` in `package.json`; `corepack
  enable` activates it automatically).
- **Docker + Docker Compose v2** for Postgres/Redis/MinIO (dev) and the full
  stack (staging/production).

## Local setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start dev data services (Postgres, Redis, MinIO) — ports 127.0.0.1 only
docker compose -p hh-dev -f infrastructure/docker/compose.dev.yml up -d --wait

# 3. Apply migrations + seed reference data
cd packages/database
pnpm exec prisma migrate deploy
SEED_DEV_ACCOUNTS=1 pnpm seed   # creates dev-superadmin@local.test etc.
cd ../..

# 4. Boot the API (port 3100 — 3000 is reserved on shared hosts)
pnpm --filter @hh/api dev

# 5. In another terminal, boot the worker (BullMQ processors)
pnpm --filter @hh/worker dev

# 6. In another terminal, boot the admin dashboard (port 3002)
pnpm --filter @hh/admin-web dev
```

API docs: `http://localhost:3100/docs` (Swagger UI — on by default outside
production; set `SWAGGER_ENABLED=true` to also enable it in production).
Health check: `http://localhost:3100/health/live`.

Dev seed accounts (see `packages/database/prisma/seed.ts`,
`SEED_DEV_ACCOUNTS=1`): `dev-superadmin@local.test`,
`dev-datamanager@local.test`, `dev-reviewer@local.test`,
`dev-support@local.test`, `dev-user@local.test` — passwords are in the seed
file, dev-only, never used in staging/production.

## Running tests

```bash
# Unit tests (no containers required)
pnpm test

# Integration tests (spins up a throwaway Postgres/Redis/MinIO stack,
# runs migrations, executes, tears down)
./scripts/test-integration.sh

# Full CI-equivalent pipeline
./scripts/ci.sh
```

## Repository layout

```
apps/api           NestJS REST API (public /api/v1 + admin /api/v1/admin)
apps/worker        BullMQ background job processors
apps/admin-web      Next.js admin dashboard
packages/domain     Framework-free business logic (calc engine, snapshots, guidance, scheduling)
packages/database   Prisma schema, migrations, seeds
packages/contracts  Shared Zod schemas, DTOs, error codes
packages/auth       Auth primitives + Nest guards
packages/storage    Object storage port + MinIO adapter
packages/notifications  Email/push ports + dev providers
packages/pipeline   Import runner, dataset release lifecycle, reminder sweeper
packages/config     Typed env loading
packages/testing    Integration test helpers
infrastructure/docker, infrastructure/nginx   Deployment infra
docs/               Architecture, ADRs, runbooks, API/data docs
scripts/            CI, backup/restore, deployment scripts
```

## Documentation index

- `docs/module-overview.md` — what lives where
- `docs/architecture/erd.md`, `docs/architecture/*.md` — data model
- `docs/adr/` — architecture decision records
- `docs/api-overview.md` — API conventions and surface map
- `docs/admin-operations.md` — how to operate the admin dashboard/API
- `docs/calculations.md`, `docs/calculation-policy-versioning.md` — calorie engine
- `docs/food-schema-spec.md`, `docs/search-normalization.md` — food dataset
- `docs/data-sources.md`, `docs/import-template.md` — import pipeline
- `docs/security-privacy.md` — security posture, PII inventory
- `docs/backup-restore.md`, `docs/runbooks/` — operations
- `docs/mobile-integration.md` — guide for a future mobile client
# house-health
