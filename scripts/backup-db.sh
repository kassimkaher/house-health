#!/usr/bin/env bash
# PostgreSQL backup via pg_dump custom format (compressed, pg_restore-able).
#
# Usage:
#   COMPOSE_PROJECT=hh-prod ./scripts/backup-db.sh [output-dir]
#
# Defaults target the dev stack. Production cron should call this with
# COMPOSE_PROJECT=hh-prod and an output dir on the backup volume, then
# replicate off-box (see docs/runbooks/backup-restore.md — off-box replication
# is REQUIRED; this script alone leaves backups on the same failure domain).
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-hh-dev}"
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-hh}"
PG_DB="${PG_DB:-health_house}"
OUT_DIR="${1:-./backups/pg}"
RETENTION_DAILY="${RETENTION_DAILY:-14}"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/${PG_DB}_${STAMP}.dump"

docker compose -p "$COMPOSE_PROJECT" exec -T "$PG_SERVICE" \
  pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$OUT_FILE"

echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Retention: keep newest N dumps.
ls -1t "$OUT_DIR"/*.dump 2>/dev/null | tail -n +$((RETENTION_DAILY + 1)) | xargs -r rm --
echo "Retention: keeping newest $RETENTION_DAILY dumps in $OUT_DIR"
