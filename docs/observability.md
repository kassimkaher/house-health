# Observability

## Structured logging

`apps/api` uses `nestjs-pino` for JSON-structured logs. Every request gets a
correlation id (`x-request-id`): reused from the incoming header when a
reverse proxy or client already set one, otherwise generated
(`crypto.randomUUID()`), and echoed back on the response so a client can
report "what request id failed" for support. Pino attaches the id to every
log line emitted during that request's lifecycle.

**Redaction** (never appear in logs, replaced with `[REDACTED]`):
`Authorization` header, `Cookie` header, `password`/`refreshToken` request
body fields, `Set-Cookie` response header.

In `development`, logs render human-readable via `pino-pretty`; in
`production` and `test`, plain JSON (test additionally sets `level: silent`
to keep integration test output readable). `apps/worker` uses plain `pino`
for the same JSON shape without the HTTP-request wrapper (it has no inbound
HTTP traffic besides its health/metrics listener).

## Metrics

`GET /metrics` (unversioned, outside `/api/v1`) exposes Prometheus-format
metrics via `prom-client`:

- Default Node.js process metrics (CPU, memory, event-loop lag, GC).
- `http_request_duration_seconds` — histogram, labeled by `method`, `route`
  (the matched route pattern, e.g. `/foods/:idOrSlug` — never the raw path,
  which would blow up label cardinality with real ids), `status`.
- `http_requests_total` — counter, same labels.
- `auth_failures_total` — counter, labeled by `reason` (reserved for wiring
  into the auth failure paths as a follow-up; the metric exists now so
  dashboards can be built against a stable name).

`/metrics` carries no user data and is intentionally unauthenticated at the
app layer — Nginx restricts it to the internal network in production (see
`docs/runbooks/deploy.md`), matching the spec's "no dev tools exposed
publicly" requirement without adding auth friction for the scrape target.

## Tracing

OpenTelemetry hooks are wired but dormant (`OTEL_ENABLED` env flag, default
`false`) — `apps/api/src/infra/tracing.ts`. Single server, no collector
deployed in this phase; the flag and config surface
(`OTEL_EXPORTER_OTLP_ENDPOINT`) exist so enabling real tracing later is an
env change plus installing `@opentelemetry/sdk-node` and completing the
seam, not a design change.

## Error tracking

`ErrorTrackingPort` (`packages/notifications/src/error-tracking.ts`) —
default `LogErrorTrackingProvider` writes a structured JSON line to stderr
(captured by the same logging pipeline). Every 5xx response triggers a
capture via the global `AllExceptionsFilter`, which also guarantees the
client never sees a raw stack trace: known `HttpException`s pass through
with their existing machine-readable body; anything else becomes a generic
`{code: "internal_error"}`. Swapping in a real APM (Sentry, etc.) means
implementing `ErrorTrackingPort` and binding it in place of the log
provider — no call sites change.

## Health checks

- `GET /health/live` — process liveness only, no dependency checks. Used
  for container liveness probes.
- `GET /health/ready` — checks Postgres (`SELECT 1`), Redis (`PING`), and
  MinIO (`HeadBucket` on `food-images`), each with a 2s timeout; 200 with
  per-dependency status, or 503 if any dependency fails. Used for readiness
  probes and the deploy script's "did the new version actually come up"
  check.
- Both endpoints are excluded from the `/api/v1` prefix and from
  authentication (`@Public()`).

MinIO buckets are auto-provisioned at application startup
(`StorageModule`'s `BucketBootstrap.onModuleInit`, calling
`ObjectStorage.ensureBuckets()`) — `/health/ready`'s storage check and any
upload endpoint both depend on the buckets existing, so this runs
unconditionally on boot rather than being a manual setup step.

## Graceful shutdown

`app.enableShutdownHooks()` is set in `apps/api/src/main.ts`; NestJS's
lifecycle hooks (`onModuleDestroy`, `onApplicationShutdown`) close the
BullMQ `Queue` clients (imports/catalog/reminders) and the Prisma
connection cleanly on `SIGTERM`/`SIGINT`. `apps/worker` implements shutdown
manually (`apps/worker/src/main.ts`): closes its BullMQ `Worker` instances
(which wait for in-flight jobs to finish before disconnecting), the health
HTTP listener, and the Nest application context, in that order.

## Verifying locally

```bash
# Boot the compiled app for real (not just tests) — proves the production
# build actually runs, not merely typechecks.
pnpm build
DATABASE_URL=... REDIS_URL=... node apps/api/dist/main.js

curl localhost:3100/health/live
curl localhost:3100/health/ready
curl localhost:3100/metrics | grep http_requests_total
```
