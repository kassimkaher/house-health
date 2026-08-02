#!/usr/bin/env bash
# Two-step TLS activation (see docs/runbooks/tls.md). Run AFTER certbot has
# successfully issued certificates for all three domains — this script only
# swaps Nginx config and reloads, it does not request certificates itself.
#
# Usage:
#   COMPOSE_PROJECT=hh-prod ./scripts/enable-tls.sh          # enable
#   COMPOSE_PROJECT=hh-prod ./scripts/enable-tls.sh --revert # back to HTTP-only
set -euo pipefail
cd "$(dirname "$0")/.."

CONF_DIR="infrastructure/nginx/conf.d"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-hh-prod}"
COMPOSE_FILES=(-f infrastructure/docker/compose.base.yml -f "infrastructure/docker/compose.${COMPOSE_PROJECT#hh-}.yml")

sites=(api admin s3)

if [ "${1:-}" = "--revert" ]; then
  echo "==> Reverting to HTTP-only Nginx config"
  for site in "${sites[@]}"; do
    git checkout -- "$CONF_DIR/${site}.conf" 2>/dev/null || {
      echo "Cannot git-revert $CONF_DIR/${site}.conf automatically — restore it manually from version control."
      exit 1
    }
  done
else
  echo "==> Enabling TLS"
  for site in "${sites[@]}"; do
    variant="$CONF_DIR/${site}.conf.https-enabled"
    target="$CONF_DIR/${site}.conf"
    [ -f "$variant" ] || { echo "Missing $variant"; exit 1; }
    cp "$variant" "$target"
    echo "  installed $target from $variant"
  done
fi

echo "==> Validating Nginx config"
docker compose -p "$COMPOSE_PROJECT" "${COMPOSE_FILES[@]}" exec nginx nginx -t

echo "==> Reloading Nginx"
docker compose -p "$COMPOSE_PROJECT" "${COMPOSE_FILES[@]}" exec nginx nginx -s reload

echo "==> Done. Verify: curl -I https://api-health-house.aljoodnet.info/health/live"
