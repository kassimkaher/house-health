#!/usr/bin/env bash
# CI-style verification pipeline. Run from the repo root.
# Stages: lint -> typecheck -> unit tests -> integration tests -> openapi drift.
# Integration tests require the test compose stack (scripts/test-integration.sh
# starts and stops it).
set -euo pipefail

cd "$(dirname "$0")/.."

# Host tooling must be Node 22 (see .nvmrc). Prefer nvm-installed node.
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE22_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "${NODE22_BIN:-}" ] && export PATH="$NODE22_BIN:$PATH"
fi

echo "==> node $(node --version) / pnpm $(pnpm --version)"

echo "==> lint"
pnpm lint

echo "==> typecheck"
pnpm typecheck

echo "==> unit tests"
pnpm test

if [ "${SKIP_INTEGRATION:-0}" != "1" ]; then
  echo "==> integration tests"
  ./scripts/test-integration.sh
fi

if [ "${SKIP_OPENAPI:-0}" != "1" ] && [ -f docs/openapi.json ]; then
  echo "==> openapi drift check"
  # generate-openapi.ts only needs to boot the Nest DI graph and introspect
  # routes/schemas — it never queries the DB or Redis — but the config
  # loader requires DATABASE_URL/REDIS_URL to be well-formed. The
  # integration test stack (started above) is already torn down by this
  # point, so provide throwaway values rather than depend on whatever the
  # caller's shell happens to have exported.
  DATABASE_URL="${DATABASE_URL:-postgresql://ci:ci@127.0.0.1:5999/ci_openapi_gen}" \
  REDIS_URL="${REDIS_URL:-redis://127.0.0.1:5999}" \
    pnpm openapi
  git diff --exit-code docs/openapi.json \
    || { echo "OpenAPI artifact drifted — commit the regenerated docs/openapi.json"; exit 1; }
fi

echo "==> OK"
