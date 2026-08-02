# TLS Runbook

TLS terminates at Nginx. The platform ships **TLS-ready**: HTTP works from
first boot, HTTPS is a documented two-step switch once DNS is pointed at the
server (see `docs/runbooks/deploy.md` for the full deployment sequence —
this file covers only the certificate lifecycle).

## Why two steps

Nginx cannot start with `ssl_certificate` directives pointing at files that
don't exist yet, and Let's Encrypt's HTTP-01 challenge requires a running
HTTP server on port 80 to serve the challenge token — so the correct order
is: boot HTTP-only Nginx → issue the first certificate → enable the HTTPS
server block → reload Nginx.

## Step 1 — first boot (HTTP only)

`infrastructure/nginx/` ships `ssl_certificate`/`ssl_certificate_key` lines
**commented out** in the site configs. Bring the stack up as documented in
the deploy runbook; confirm `http://api.<domain>/health/live` and
`http://admin.<domain>` respond.

## Step 2 — issue the certificate

```bash
docker compose -p hh-prod -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d api.<domain> -d admin.<domain> \
  --email <ops-email> --agree-tos --no-eff-email
```

Certbot writes to the shared `certbot_certs` volume, mounted read-only into
the Nginx container at `/etc/letsencrypt`.

## Step 3 — enable HTTPS

```bash
./scripts/enable-tls.sh   # uncomments ssl_certificate lines, adds the
                           # HTTP→HTTPS redirect, validates config
docker compose -p hh-prod -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml exec nginx nginx -s reload
```

Confirm `https://api.<domain>/health/live` and `https://admin.<domain>`
respond, and that plain `http://` now redirects.

## Renewal

Certbot certificates expire after 90 days. Renewal via host cron (weekly is
safe — certbot no-ops if not yet due):

```cron
0 3 * * 0 cd /opt/health-house && docker compose -p hh-prod -f infrastructure/docker/compose.base.yml -f infrastructure/docker/compose.prod.yml run --rm certbot renew --webroot -w /var/www/certbot && docker compose -p hh-prod -f infrastructure/docker/compose.base.yml -f infrastructure/docker/compose.prod.yml exec nginx nginx -s reload
```

## Rollback

If a bad Nginx config change breaks HTTPS, `./scripts/enable-tls.sh
--revert` (documented alongside the script) restores the HTTP-only config
from the same template used in step 1 — certificates themselves are never
deleted by this, only the Nginx directives referencing them.

## Staging

The staging Compose project (`hh-staging`) shares the same certbot flow
against `api.staging.<domain>` / `admin.staging.<domain>` subdomains —
independent certificates, independent renewal cron entry.
