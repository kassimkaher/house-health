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
  pnpm openapi
  git diff --exit-code docs/openapi.json \
    || { echo "OpenAPI artifact drifted — commit the regenerated docs/openapi.json"; exit 1; }
fi

echo "==> OK"
