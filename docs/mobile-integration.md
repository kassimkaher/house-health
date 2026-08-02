# Future Mobile Integration Guide

No mobile client is built in this phase (explicit non-goal). This document
orients a future Flutter/native client against the backend that exists
today.

## Base URL & versioning

All endpoints live under `/api/v1`. The backend is designed so a mobile
client can pin to `v1` indefinitely — breaking changes would ship as `v2`
alongside it, not as in-place changes.

## Authentication

Mobile clients use **bearer tokens**, not cookies:

1. `POST /auth/login` (no `?client=web`) returns `{ accessToken,
   accessExpiresIn, refreshToken, user }` in the JSON body.
2. Send `Authorization: Bearer <accessToken>` on every subsequent request.
3. On 401 with `code: "auth.token_expired"`, call `POST /auth/refresh` with
   `{ refreshToken }` to get a new pair. **Refresh tokens rotate on every
   use** — always store the newly returned `refreshToken`, discard the old
   one. Presenting an already-used refresh token is treated as theft and
   revokes the entire session.
4. `POST /auth/logout` revokes the current session; `GET /auth/sessions` /
   `DELETE /auth/sessions/:id` support a "log out other devices" UI.
5. Google sign-in: `GET /auth/google/start` returns `{ url }` to open in a
   web view/browser; the redirect lands on `/auth/google/callback` which
   returns the same token shape as `/auth/login`.

Mobile clients are exempt from the CSRF double-submit requirement that
applies to admin-web's cookie sessions — bearer tokens aren't ambient
browser credentials, so CSRF doesn't apply to them.

## The `/home` endpoint

`GET /home` is purpose-built for a mobile home screen: today's diary summary
+ guidance, recent foods (as ready-to-render search cards), favorites, and
the next scheduled reminder — one round trip instead of five.

## Search cards vs. detail

`GET /foods/search` returns compact cards (`FoodSearchCard` — name, brand,
kcal/protein per 100g, default portion, one image ref). Fetch
`GET /foods/:idOrSlug` only when the user opens a food's detail screen — it
carries the full nutrient map, all portions, and aliases. Don't request
detail for every search result; the split exists specifically to keep list
payloads small.

## Logging a food

1. Resolve the quantity the user entered to grams client-side is **not**
   supported/needed — send `{ foodId, quantity, unit, portionLabelEn? }` to
   `POST /diary/entries` and the server resolves grams (from the food's
   known portions/density) and computes the nutrition snapshot. If the unit
   can't be resolved (e.g. `ml` on a food with no known density, or an
   unknown portion label), the server returns `422
   food.unit_conversion_failed` — surface this to the user rather than
   guessing a conversion client-side; the platform's principle is "never
   invent a gram conversion."
2. Editing an entry's quantity later (`PATCH /diary/entries/:id`) recomputes
   the snapshot from the **originally logged food version** — history stays
   reproducible even if the dataset has since changed.

## Offline considerations (not implemented, design guidance only)

The immutable-snapshot design is offline-friendly by construction: once a
diary entry is created, its nutrition never depends on a live network call
to re-resolve. A future offline mode could queue `POST /diary/entries`
calls locally and replay them on reconnect; the server-side idempotency-key
mechanism (currently wired for imports) is the natural extension point if
duplicate-submission-on-retry becomes a concern for mobile.

## Push notifications

Reminders are scheduled server-side; delivery goes through a
provider-neutral push port. In this phase only a log provider is live (no
real push credentials configured). When a mobile client exists,
`POST /devices` (not yet built — add alongside push token registration) or
an equivalent endpoint would register FCM tokens against
`push_tokens.token`; the reminder sweeper already reads from that table, so
wiring a real FCM provider (`packages/notifications`'s `FcmPushProvider`
seam) is the only change required — no reminder/scheduling logic changes.

## Things a mobile client should never do

- Compute nutrition totals itself — always trust the server's snapshot
  values (`nutritionSnapshot.nutrients`), which are pre-scaled to the logged
  quantity.
- Cache food nutrient data indefinitely without a release-aware
  invalidation strategy — the active dataset release can change; search
  results/details reflect the current release at request time.
- Assume `foodId` stability implies nutrient stability — always read
  nutrients from what the API returned for that request, not from a
  previously cached food detail payload, since editorial corrections can
  publish between requests.
