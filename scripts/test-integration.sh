#!/usr/bin/env bash
# Starts throwaway test data services, runs integration tests, tears down.
set -euo pipefail

cd "$(dirname "$0")/.."

# Host tooling must be Node 22 (see .nvmrc). Prefer nvm-installed node.
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE22_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "${NODE22_BIN:-}" ] && export PATH="$NODE22_BIN:$PATH"
fi

COMPOSE=(docker compose -p hh-test -f infrastructure/docker/compose.test.yml)

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${COMPOSE[@]}" up -d --wait

export DATABASE_URL="postgresql://hh_test:hh_test@127.0.0.1:5434/health_house_test"
export REDIS_URL="redis://127.0.0.1:6381"
export S3_ENDPOINT="http://127.0.0.1:9002"
export S3_ACCESS_KEY="hh_test"
export S3_SECRET_KEY="hh_test_secret"

pnpm test:integration
