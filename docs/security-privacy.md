# Security & Privacy Notes

## OWASP-aligned protections implemented

- **Injection**: all database access goes through Prisma's parameterized
  query builder; the few raw SQL call sites (`$queryRaw`/`$executeRaw` in
  search, duplicate detection, and release publishing) use tagged-template
  parameterization exclusively — no string concatenation into SQL anywhere
  in the codebase.
- **Broken authentication**: argon2id password hashing (64 MiB, 3 passes),
  ES256 access tokens (10 min default TTL), rotating refresh tokens with
  reuse detection (a replayed refresh token revokes its entire session
  family and denylists the session immediately via Redis), per-account
  exponential lockout after repeated failed logins, generic error responses
  for all login failure modes (no user enumeration).
- **Sensitive data exposure**: passwords are never logged (pino redaction
  list covers `authorization`, `cookie`, password fields); refresh/action
  tokens are stored as sha256 hashes, never in plaintext; nutrition search
  analytics store only the normalized query term, never free-text PII.
- **Broken access control**: every resource-scoped endpoint filters by
  owning `userId` at the query level (not just at the guard level) —
  verified by IDOR regression tests across profile, weight entries, recipes,
  meal groups, diary entries, and sessions. Admin permission checks
  (`@RequirePermission`) are enforced by a global guard, not per-controller
  opt-in.
- **CSRF**: admin-web's cookie-based sessions require a double-submit
  `x-csrf-token` header matching the readable `hh_csrf` cookie on every
  mutating request; bearer-token (mobile/API) clients are exempt since CSRF
  targets ambient browser credentials specifically.
- **Security misconfiguration**: environment validation fails fast and
  loudly (`packages/config`) rather than falling back to insecure defaults
  in production; Swagger UI is disabled outside `development`/`test`.

## Rate limiting

Global per-IP throttle (`@nestjs/throttler` + Redis-backed storage) plus a
stricter auth-endpoint class; per-account login lockout is independent of
the IP-based throttle so a distributed attack against one account is still
caught even from many source IPs.

## PII inventory

| Data | Where stored | Notes |
|---|---|---|
| Email | `users.email` (citext) | Unique among active accounts; freed on soft delete. |
| Password hash | `users.password_hash` | argon2id, never plaintext, never logged. |
| Display name, locale, timezone | `user_profiles` | User-editable. |
| Health data (sex, birth date, height, weight, goals) | `user_profiles`, `weight_entries` | Used only for calorie calculations; no diagnosis or medical claims. |
| Weight photos | `weight_entries.photo_key` (private object storage) | Presigned-URL access only. |
| Diary/recipe nutrition history | `diary_entries`, `recipe_ingredients` | Immutable snapshots; retained for the account's lifetime. |
| Session metadata | `sessions` | Device name, user agent, IP at creation. |
| Search analytics | `search_query_logs` | Normalized term only, optional `userId`, no raw free text retained beyond the normalized form. |
| Audit trail | `audit_log` | Actor id/roles, IP, before/after JSON for admin actions — append-only. |

## Account export & deletion

- Soft delete only (`users.status = 'deleted'`, `deletedAt` set) — rows are
  retained for audit/compliance rather than hard-deleted; email is freed for
  re-registration via a partial unique index scoped to `deleted_at IS NULL`.
  Self-deletion of the acting admin account is blocked at the service layer.
- A dedicated data-export endpoint is not yet implemented in this phase; the
  admin audit log and per-resource GET endpoints together allow assembling a
  full export for a support request. Tracked as a phase-2 follow-up (see
  final report "known limitations").

## Secrets

No secrets are committed to source control. `.env` files are gitignored
except `*.env.example` templates with placeholder values. Production
secrets are injected via environment variables (Docker secrets/host env),
never baked into images.

## Uploads

File-type and size validation happens at the API boundary (import files:
`.csv`/`.json` extension check + 25 MB limit; presigned uploads for images
are intended to be validated by a `media` queue worker before flipping
`media_assets.status` from `pending` to `ready` — the malware-scan
integration point is the same worker, prepared as a seam but no scanner is
wired in this phase since no scanning service was specified).

## Encryption in transit

TLS termination happens at Nginx (see `docs/runbooks/deploy.md` and
`docs/runbooks/tls.md`); internal service-to-service traffic (API↔Postgres,
API↔Redis, API↔MinIO) stays on the Docker-internal network, not exposed to
the host or internet.

## Least privilege

Database and object-storage credentials used by the application are scoped
to the application's own schema/buckets — the Contabo deployment runbook
documents creating dedicated non-superuser Postgres roles and per-purpose
MinIO buckets (`food-images`, `user-uploads`, `imports`, `exports`) rather
than a single shared credential.
