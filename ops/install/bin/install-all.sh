#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

"${ROOT_DIR}/ops/install/bin/00-bootstrap.sh"
"${ROOT_DIR}/ops/install/bin/10-harden.sh"
"${ROOT_DIR}/ops/install/bin/20-deploy-gateway.sh"

if [[ -n "${TUNNEL_ID:-}" && -n "${TUNNEL_HOSTNAME:-}" ]]; then
  "${ROOT_DIR}/ops/install/bin/30-cloudflared.sh"
else
  echo "[install-all] skipping cloudflared tunnel wiring (set TUNNEL_ID and TUNNEL_HOSTNAME to enable)"
fi

"${ROOT_DIR}/ops/install/bin/40-verify.sh"

echo "[install-all] completed"
