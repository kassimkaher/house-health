#!/usr/bin/env bash
# Deploy (or upgrade) the api/worker/admin-web stack on this host.
# Migrations run as a dedicated one-shot step BEFORE the apps restart —
# apps never migrate on their own boot (see docs/adr/0001, "controlled
# deployment only").
#
# Usage:
#   COMPOSE_PROJECT=hh-prod ENV_FILE=infrastructure/docker/.env.production ./scripts/deploy.sh
#   COMPOSE_PROJECT=hh-staging ENV_FILE=infrastructure/docker/.env.staging ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_PROJECT="${COMPOSE_PROJECT:?set COMPOSE_PROJECT=hh-prod or hh-staging}"
ENV_FILE="${ENV_FILE:?set ENV_FILE=infrastructure/docker/.env.production (or .env.staging)}"
PROFILE="${COMPOSE_PROJECT#hh-}" # "prod" or "staging"
COMPOSE=(docker compose -p "$COMPOSE_PROJECT" \
  -f infrastructure/docker/compose.base.yml \
  -f "infrastructure/docker/compose.${PROFILE}.yml" \
  --env-file "$ENV_FILE")

echo "==> Building images ($COMPOSE_PROJECT)"
"${COMPOSE[@]}" build api worker admin-web migrate

echo "==> Running database migrations"
"${COMPOSE[@]}" run --rm migrate

echo "==> Starting/updating services"
"${COMPOSE[@]}" up -d postgres redis minio api worker admin-web nginx

echo "==> Waiting for api readiness"
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:3100/health/ready >/dev/null 2>&1; then
    echo "    api is ready"
    break
  fi
  sleep 2
done

echo "==> Current status"
"${COMPOSE[@]}" ps

echo "==> Deploy complete. Record this IMAGE_TAG for rollback: ${IMAGE_TAG:-latest}"
