# Backup & Restore Guide

## PostgreSQL

`scripts/backup-db.sh` runs `pg_dump -Fc` (custom format, compressed,
`pg_restore`-compatible) inside the target Compose project's postgres
container and writes to a host directory, with retention (default: newest
14 dumps kept).

```bash
COMPOSE_PROJECT=hh-prod ./scripts/backup-db.sh /var/backups/health-house/pg
```

Schedule nightly via host cron (see `docs/runbooks/deploy.md` for the
production crontab). **Off-box replication is required**, not optional —
Postgres, MinIO, and the backup directory sharing one disk is a single
failure domain. Mirror the backup directory to Contabo Object Storage,
Backblaze B2, or equivalent (`rclone`/`mc mirror`) as a second cron step.

## MinIO / object storage

Buckets (`food-images`, `user-uploads`, `imports`, `exports`) are mostly
write-once (images, uploaded import files). Mirror them off-box with `mc
mirror --overwrite <alias>/<bucket> <remote>/<bucket>` on the same schedule
as the Postgres backup. Enable MinIO bucket versioning in production as a
delete-protection layer.

## Restore procedure

`scripts/restore-db.sh` restores a `pg_dump` file into a **throwaway**
database — it refuses to overwrite an existing target database unless
`FORCE_RESTORE=1` is set, and defaults to the `hh-test` Compose project so a
restore drill never touches staging or production data:

```bash
COMPOSE_PROJECT=hh-test ./scripts/restore-db.sh /var/backups/health-house/pg/health_house_20260801T020000Z.dump
```

This creates `health_house_restore_test` inside the `hh-test` postgres
container and reports the restored table count.

### Monthly restore drill (required, not optional)

A backup that has never been restored is not a backup. Monthly:

1. Copy the latest production dump to this machine (or run the restore
   directly on a disposable environment with access to the off-box copy).
2. `./scripts/restore-db.sh <latest-dump>`.
3. Verify: table count matches expectations, spot-check a handful of rows
   in `users`, `foods`, `dataset_releases` (confirm the active release
   matches production at dump time), and confirm `_prisma_migrations`
   shows the expected latest migration.
4. Restore a handful of MinIO objects via `mc cp` from the mirrored backup
   and checksum them against the mirror source.
5. Tear down the throwaway database (`docker compose -p hh-test down -v` or
   drop just the restored database) — this drill must never leave
   production-shaped data sitting in a shared test environment.

Record the drill date, dump timestamp restored, and pass/fail in the
deployment log (see `docs/runbooks/deploy.md`).
