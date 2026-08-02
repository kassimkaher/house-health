# Rollback Runbook (quick reference)

Full context lives in `docs/runbooks/deploy.md` — this file is the
short version for an incident in progress.

## Application rollback (code/config issue, schema unchanged)

```bash
cd /opt/health-house
IMAGE_TAG=<previous-good-sha> COMPOSE_PROJECT=hh-prod \
  ENV_FILE=infrastructure/docker/.env.production ./scripts/deploy.sh
```

Safe to run repeatedly; `migrate` is a no-op if the schema at that tag
matches what's already applied.

## Dataset rollback (bad food data published)

Not a deployment rollback — use the release rollback endpoint instead,
nothing to redeploy:

```bash
curl -X POST https://api-health-house.aljoodnet.info/api/v1/admin/releases/<previous-release-id>/rollback \
  -H "Authorization: Bearer <admin-token>"
```

See `docs/architecture/dataset-release-lifecycle.md`.

## Database rollback (destructive migration went out)

Application-code rollback does **not** undo a destructive migration.

1. Stop the app tier so nothing writes further: `docker compose -p hh-prod ... stop api worker`.
2. Restore the most recent pre-deploy backup into a **throwaway** database
   first and verify it (`docs/backup-restore.md`) — never restore directly
   over production without this check.
3. Once verified, restore into production following the same guide's
   procedure, adapted for the production database name.
4. Redeploy the previous known-good `IMAGE_TAG` (see above) so the app
   version matches the restored schema.
5. Confirm `/health/ready` and spot-check a few admin screens before
   resuming write traffic.

## Rollback verification checklist

- [ ] `curl -sf https://api-health-house.aljoodnet.info/health/ready` returns `{"status":"ok"}`
- [ ] `docker compose -p hh-prod ... ps` shows all services `healthy`
- [ ] Admin login works (`https://health-house.aljoodnet.info`)
- [ ] A read-only spot check (e.g. `/api/v1/foods/search?q=...`) returns
      expected data
- [ ] Audit log (`GET /admin/audit`) shows no unexpected writes during the
      incident window
