# Deploy, Rollback & Upgrade Runbook

Target: a single Contabo VPS running production and staging as two
independent Docker Compose projects. Domains used throughout this guide:

- Admin dashboard: `health-house.aljoodnet.info`
- API: `api-health-house.aljoodnet.info`
- Object storage (presigned URL host): `s3-health-house.aljoodnet.info`
- Staging mirrors these with a `staging.` prefix if/when a staging DNS
  record is created (not required for the production-only path below).

## One-time server setup

```bash
# Docker + Compose plugin (Ubuntu/Debian host)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in to pick this up

# Clone the repo
sudo mkdir -p /opt/health-house && sudo chown "$USER" /opt/health-house
git clone <repo-url> /opt/health-house
cd /opt/health-house

# DNS: point all three A/AAAA records at this server's IP before continuing
#   health-house.aljoodnet.info        -> <server IP>
#   api-health-house.aljoodnet.info    -> <server IP>
#   s3-health-house.aljoodnet.info     -> <server IP>
```

## First deploy (HTTP only — TLS is a separate step)

```bash
cd /opt/health-house
cp infrastructure/docker/.env.example infrastructure/docker/.env.production
# Edit .env.production: set real POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD,
# JWT_PRIVATE_KEY_PEM/JWT_PUBLIC_KEY_PEM (see the file's comments for the
# openssl commands), and optionally GOOGLE_CLIENT_ID/SECRET.

COMPOSE_PROJECT=hh-prod ENV_FILE=infrastructure/docker/.env.production ./scripts/deploy.sh
```

`scripts/deploy.sh` builds the four images (api, worker, admin-web,
migrate), runs `migrate` as a one-shot job, then starts
postgres/redis/minio/api/worker/admin-web/nginx and waits for
`/health/ready`. At this point:

- `http://api-health-house.aljoodnet.info/health/live` responds.
- `http://health-house.aljoodnet.info` serves the admin login page.
- `http://api-health-house.aljoodnet.info/health/ready` reports
  `postgres`/`redis` as `ok` but **`storage` as `error`** — this is
  expected and not a bug. `S3_ENDPOINT`/`S3_PUBLIC_URL` is the same public
  `https://s3-...` host used for presigned URLs (see the comment in
  `compose.base.yml`), which doesn't exist yet until the TLS step below
  issues a certificate and Nginx starts terminating HTTPS for it. The api
  container stays up and keeps serving other routes in the meantime — it
  does not crash-loop. `/health/ready` (and therefore uploads/imports)
  only turns fully green once "Enable TLS" below is complete.

## Enable TLS

Once DNS has propagated and the HTTP-only stack above is confirmed working:

```bash
# Issue certificates (webroot challenge — nginx must already be serving
# /.well-known/acme-challenge/ on port 80, which it is after the step above)
docker compose -p hh-prod -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml --env-file infrastructure/docker/.env.production \
  run --rm certbot certonly --webroot -w /var/www/certbot \
  -d api-health-house.aljoodnet.info \
  -d health-house.aljoodnet.info \
  -d s3-health-house.aljoodnet.info \
  --email <ops-email> --agree-tos --no-eff-email

# Swap Nginx to the HTTPS configs and reload
COMPOSE_PROJECT=hh-prod ./scripts/enable-tls.sh
```

See `docs/runbooks/tls.md` for renewal cron and the revert procedure.

## Staging

Identical flow, different project name/env file — fully separate volumes,
networks, and containers on the same host:

```bash
cp infrastructure/docker/.env.example infrastructure/docker/.env.staging
# edit with staging-specific secrets (different Postgres/MinIO passwords —
# never reuse production credentials in staging)
COMPOSE_PROJECT=hh-staging ENV_FILE=infrastructure/docker/.env.staging ./scripts/deploy.sh
```

`compose.staging.yml` halves every resource limit versus `compose.prod.yml`
so a staging workload (e.g. a large test import) cannot starve production.

## Upgrading (new code deployed)

```bash
cd /opt/health-house
git pull
IMAGE_TAG=$(git rev-parse --short HEAD) COMPOSE_PROJECT=hh-prod \
  ENV_FILE=infrastructure/docker/.env.production ./scripts/deploy.sh
```

Tagging images with the git SHA (`IMAGE_TAG`) makes rollback a one-line
change — see below. Without an explicit `IMAGE_TAG`, images build as
`:latest` and the previous build is overwritten, which is fine for staging
but not recommended for production once you have a release cadence worth
rolling back within.

## Rollback

Two scenarios:

**1. The new deploy hasn't fully replaced the old containers yet** (deploy
script failed mid-way, e.g. migration failed): fix forward. A failed
`migrate` run means the apps were never restarted (`deploy.sh` exits before
`up -d` if `run --rm migrate` fails), so production is still running the
previous code — there is nothing to roll back.

**2. The new version is live and misbehaving**: redeploy the previous image
tag.

```bash
# Find the previous good tag (git log, or your deployment log)
IMAGE_TAG=<previous-good-sha> COMPOSE_PROJECT=hh-prod \
  ENV_FILE=infrastructure/docker/.env.production ./scripts/deploy.sh
```

This re-runs `migrate` (a no-op if the schema hasn't changed since that
tag) and restarts api/worker/admin-web from the previously-built image.
**Database migrations are not automatically reversible** — if the bad
deploy included a destructive migration, rolling back the application code
does not undo it; restoring from the pre-deploy backup
(`docs/backup-restore.md`) is the only safe path in that case. This is why
staging exists: destructive migrations should be proven there first.

## Verifying a deploy

```bash
curl -sf https://api-health-house.aljoodnet.info/health/ready | jq
curl -sfI https://health-house.aljoodnet.info | head -1
docker compose -p hh-prod -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml ps
```

`/health/ready` returning `{"status":"ok", ...}` with all three dependency
checks `ok` is the deploy's pass/fail signal — the deploy script already
polls this, but re-checking manually after DNS/TLS changes is good practice.

## Local proof (this repository, before ever touching Contabo)

Every command above was exercised against this monorepo on the development
machine using placeholder domains (loopback + `Host` header overrides,
since `aljoodnet.info` doesn't resolve to a sandbox) — see the final report
for the exact commands and their output. The Dockerfiles, compose files,
and deploy script are the same files used for that proof; only the domains
and secrets differ between the local proof and the real Contabo deploy.
