# API Documentation

Live, generated OpenAPI/Swagger UI is available at `GET /docs` — on by
default outside production, or in production too if `SWAGGER_ENABLED=true`
is set (`apps/api/src/main.ts`). This file is the narrative index; the
Swagger UI is the authoritative field-by-field
reference, and `docs/openapi.json` (generated in Phase 13/CI) is the
machine-readable artifact.

All routes are versioned under `/api/v1` except `/health/live` and
`/health/ready`, which are unversioned infrastructure endpoints.

## Response conventions

- **Success**: the resource or list directly in the response body — no
  unnecessary envelope wrapping. List endpoints that paginate return
  `{ items: [...], nextCursor: string | null }`.
- **Errors**: every non-2xx response body includes a machine-readable
  `code` field from the `ERROR_CODES` registry
  (`packages/contracts/src/error-codes.ts`), e.g. `"auth.invalid_credentials"`,
  `"validation.failed"`, `"conflict.version"`. Validation failures additionally
  include a `fields: [{path, message}]` array. Clients should switch on
  `code`, never on the human-readable message.
- **Optimistic concurrency**: high-risk admin edits (foods) require an
  `If-Match: <rowVersion>` header; a stale version returns `409
  conflict.version`.
- **Idempotency**: sensitive create operations (imports) accept an
  `Idempotency-Key` header — a retried request with the same key returns the
  original result rather than creating a duplicate.

## Public surface (bearer token or unauthenticated)

- `/auth/*` — register, verify-email, login, refresh, logout, password
  forgot/reset, Google OIDC start/callback, session list/revoke.
- `/me`, `/me/profile`, `/me/weight*`, `/me/calc/*` — the caller's own
  profile, weight history, and calorie/macro calculations.
- `/foods/search`, `/foods/barcode/:code`, `/foods/:idOrSlug` — public
  catalog reads, active dataset release only.
- `/recipes/*`, `/meal-groups/*`, `/diary/*`, `/favorites`, `/recents` —
  the caller's own consumption data.
- `/reminders/*` — the caller's own reminders + delivery log.
- `/summary/daily/:date`, `/summary/week/:endDate`, `/summary/weight-trend`,
  `/home` — deterministic summaries and the mobile home-screen aggregate.

## Admin surface (cookie or bearer token + permission)

See `docs/admin-operations.md` for the full endpoint-by-endpoint guide:
`/admin/users/*`, `/admin/catalog/*` (foods, taxonomy, duplicates),
`/admin/imports/*`, `/admin/releases/*`, `/admin/calc-policies`,
`/admin/jobs/*`, `/admin/audit`, `/admin/system/*`.

## Health

- `GET /health/live` — process liveness, no dependency checks.
- `GET /health/ready` — Postgres/Redis/MinIO connectivity (2s timeout each);
  200 with `{status:"ok", checks:{...}}` or 503 with per-dependency detail.

## Regenerating the OpenAPI artifact

```
pnpm --filter @hh/api openapi   # writes docs/openapi.json (wired in Phase 13 CI)
```

CI fails the build if the committed artifact drifts from what the running
application actually serves — see `scripts/ci.sh`.
