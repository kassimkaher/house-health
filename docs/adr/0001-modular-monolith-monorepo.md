# ADR 0001: Modular monolith in a pnpm/Turborepo monorepo

Status: accepted · Date: 2026-08-01

## Context

Phase 1 must ship a deployable backend on a single Contabo server, while
keeping later extraction into services possible without rewriting domain logic.

## Decision

One repository, pnpm workspaces + Turborepo. Three deployables (`apps/api`,
`apps/worker`, `apps/admin-web`) over shared packages. Boundaries:

- `packages/domain` is framework-free: entities, domain services (calc engine,
  snapshot builder, normalization), repository and provider **interfaces**.
  ESLint forbids importing Nest/Prisma/BullMQ/Next there.
- `packages/database` owns the Prisma schema and repository implementations.
- `packages/contracts` owns Zod schemas / DTO types / error codes shared by
  api and admin-web.
- apps are thin shells: api registers controllers + queue producers, worker
  registers queue processors; both wire the same domain services.
- Cross-module async work goes through the transactional outbox
  (`outbox_events`) drained to BullMQ — this is the future service seam.

## Consequences

- Service extraction later = move a package + its queues behind a network
  boundary; domain logic does not change.
- Single deploy artifact per app; no distributed-system tax in phase 1.
- Discipline is enforced by lint rules and code review, not process boundaries.
