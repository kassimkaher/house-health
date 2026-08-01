#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into a TARGET database.
#
# Usage:
#   COMPOSE_PROJECT=hh-test ./scripts/restore-db.sh <dump-file> [target-db]
#
# SAFETY: refuses to restore into a database that already has tables unless
# FORCE_RESTORE=1 is set. The monthly restore drill restores into the
# throwaway hh-test stack, never into production directly.
set -euo pipefail

DUMP_FILE="${1:?usage: restore-db.sh <dump-file> [target-db]}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-hh-test}"
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-hh_test}"
TARGET_DB="${2:-health_house_restore_test}"

[ -f "$DUMP_FILE" ] || { echo "dump file not found: $DUMP_FILE"; exit 1; }

EXISTING_TABLES=$(docker compose -p "$COMPOSE_PROJECT" exec -T "$PG_SERVICE" \
  psql -U "$PG_USER" -d postgres -tAc \
  "SELECT count(*) FROM pg_database d WHERE d.datname = '$TARGET_DB'")

if [ "$EXISTING_TABLES" != "0" ] && [ "${FORCE_RESTORE:-0}" != "1" ]; then
  echo "Database $TARGET_DB already exists. Set FORCE_RESTORE=1 to drop and recreate."
  exit 1
fi

docker compose -p "$COMPOSE_PROJECT" exec -T "$PG_SERVICE" \
  psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET_DB\"" -c "CREATE DATABASE \"$TARGET_DB\""

docker compose -p "$COMPOSE_PROJECT" exec -T "$PG_SERVICE" \
  pg_restore -U "$PG_USER" -d "$TARGET_DB" --no-owner --no-privileges < "$DUMP_FILE"

TABLES=$(docker compose -p "$COMPOSE_PROJECT" exec -T "$PG_SERVICE" \
  psql -U "$PG_USER" -d "$TARGET_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")

echo "Restore complete: $TARGET_DB has $TABLES tables"
