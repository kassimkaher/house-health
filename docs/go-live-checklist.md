# Go-Live Checklist

Everything in `docs/performance.md` and `FINAL_REPORT.md` was proven with
**placeholder secrets, no real DNS, and no real TLS certificate.** That's
the correct way to prove the deploy mechanics work without needing
production credentials during development — but it means a handful of
concrete things are still required before this serves real traffic. This
is that list, ordered the way you'll actually hit them during a first
deploy.

Check each box's *"how"* against `infrastructure/docker/.env.example` (the
file you're actually filling in) and `docs/runbooks/deploy.md` (the
step-by-step command sequence) — this doc tells you *what* and *why*;
those tell you *exactly how to run it*.

## 1. Server + DNS

- [ ] A Contabo VPS (or equivalent) provisioned, SSH access confirmed,
      Docker + Compose plugin installable (`docs/runbooks/deploy.md`'s
      "one-time server setup").
- [ ] Three DNS **A/AAAA records** pointed at the server's IP:
      - `health-house.aljoodnet.info` (admin dashboard)
      - `api-health-house.aljoodnet.info` (API)
      - `s3-health-house.aljoodnet.info` (object storage / presigned URLs)
      If you're deploying to *different* domains, update both
      `infrastructure/docker/.env.example`'s domain values **and** the
      `server_name` lines in `infrastructure/nginx/conf.d/*.conf` — they
      are static files, not templated from env vars.

## 2. Secrets (none are committed — generate fresh for this deploy)

- [ ] `POSTGRES_PASSWORD` — long random value, never reused from dev/staging.
- [ ] `MINIO_ROOT_PASSWORD` — same.
- [ ] JWT signing keypair (ES256 P-256):
      ```bash
      openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt -out jwt_private.pem
      openssl ec -in jwt_private.pem -pubout -out jwt_public.pem
      ```
      Paste each as a **double-quoted, real-multi-line** value in your
      `.env.production` — not flattened to literal `\n`. The `jose`
      library used for signing fails to parse a flattened key (this was a
      real bug caught during Phase 14's deploy proof; the fix is
      documented inline in `.env.example`).
- [ ] Confirm `.env.production` is **not** committed —
      `.gitignore` already excludes `.env.*` except the example file, but
      double-check before your first `git add` on a real server checkout.

## 3. Optional integrations — decide now, wire later is fine

None of these block a first deploy; the app runs correctly without them
(Google sign-in simply doesn't appear as an option; email/push go to
container logs instead of real inboxes/devices).

- [ ] **Google OIDC** (social login). If wanted: create an OAuth client in
      Google Cloud Console, set the authorized redirect URI to
      `https://api-<your-domain>/api/v1/auth/google/callback`, fill
      `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.
      Leave all three blank to disable — the config loader requires all
      three or none.
- [ ] **Real email provider** (verification/reset emails). Currently
      `LogEmailProvider` writes the email body to container stdout — fine
      for a controlled first deploy where you can `docker logs` for the
      verification link, not fine for real users. Wiring a real SMTP/SES
      provider is a `packages/notifications` `EmailPort` implementation;
      see `HANDOVER.md`'s "what's not done" list.
- [ ] **Real push provider** (FCM) — same situation, only relevant once a
      mobile client exists.
- [ ] **Error tracking** (`ERROR_TRACKING_DSN`) and **OTel traces**
      (`OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT`) — both seams
      are wired and dormant by default; point them at a real
      Sentry-compatible / OTLP endpoint whenever you have one.

## 4. First deploy (HTTP only)

Follow `docs/runbooks/deploy.md` exactly — it's the tested command
sequence, not paraphrased here. In short: `scripts/deploy.sh` builds
images, runs `migrate` as a one-shot job, brings the stack up, and polls
`/health/ready`. Expect `storage: error` in that health check until TLS is
issued in the next step (see the runbook's note on why — MinIO is reached
through the same public HTTPS hostname used for presigned URLs, which
doesn't resolve to anything meaningful until the API can reach it, which
this step doesn't require and the next one fixes).

- [ ] `curl http://api-<domain>/health/live` responds.
- [ ] `curl http://<admin-domain>/` serves the login page.

## 5. TLS

- [ ] Run `scripts/enable-tls.sh` per `docs/runbooks/tls.md` (certbot
      webroot issuance for all three domains, then swaps Nginx to the
      `.https-enabled` config variants).
- [ ] Re-check `/health/ready` — `storage` should now read `ok`.
- [ ] Confirm the renewal cron from `docs/runbooks/tls.md` is actually
      scheduled, not just documented.

## 6. Data

- [ ] Run the base seed (`packages/database/prisma/seed.ts` — nutrient
      definitions, categories, calc policy). **Do not** run it with
      `SEED_DEV_ACCOUNTS=1` in production — that flag creates accounts
      with published default passwords, meant for local dev only.
- [ ] Create your first real `super_admin` account: register normally
      through the API/admin-web login page, verify the email, then
      promote that one account directly in the database — there's no
      self-service "first user is auto-admin" path, and the admin role-set
      endpoint (`POST /admin/users/:id/roles`) itself requires
      `users.manage`, which nobody has yet:
      ```sql
      UPDATE users SET roles = ARRAY['super_admin']::"UserRole"[] WHERE email = 'you@example.com';
      ```
      (`roles` is a Postgres enum array — the `::"UserRole"[]` cast is
      required or the literal won't match the column type.)
      Every subsequent role change should go through the admin-web UI or
      the API (both are audit-logged); this direct SQL update is a
      one-time bootstrap exception, not the normal path.
- [ ] Decide the initial food dataset: import real data through the admin
      import pipeline (`docs/admin-operations.md`) or start with an empty
      catalog and grow it. Either way, publish an active
      `dataset_release` before enabling search-dependent features for
      real users — nothing is publicly readable until a release is
      published.

## 7. Backups

- [ ] Schedule the nightly backup cron per `docs/runbooks/backup-cron.md`.
- [ ] **Off-box replication is a hard requirement, not a nice-to-have** —
      backups landing on the same disk as Postgres/MinIO share a failure
      domain with the data they're protecting. `docs/backup-restore.md`
      flags this explicitly; it was left as a placeholder for your actual
      infrastructure (S3-compatible bucket, another host, etc.) since it
      depends on what you have available.
- [ ] Do the monthly restore-test procedure at least once now, before
      you need it for real (`docs/backup-restore.md`).

## 8. Verification

Run through `docs/runbooks/deploy.md`'s "Verifying a deploy" section, then
the user-journey smoke test: register → verify → log in → set a profile →
get a calorie estimate → search for a food → log a diary entry → check the
day summary. If dataset import is part of your launch, also walk one
release publish → rollback cycle for real before you need it under
incident pressure.
