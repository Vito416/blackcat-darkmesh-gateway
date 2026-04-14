#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

bash "${ROOT_DIR}/ops/install/bin/00-bootstrap.sh"
bash "${ROOT_DIR}/ops/install/bin/10-harden.sh"
bash "${ROOT_DIR}/ops/install/bin/20-deploy-gateway.sh"

if [[ -n "${TUNNEL_ID:-}" && -n "${TUNNEL_HOSTNAME:-}" ]]; then
  bash "${ROOT_DIR}/ops/install/bin/30-cloudflared.sh"
else
  echo "[install-all] skipping cloudflared tunnel wiring (set TUNNEL_ID and TUNNEL_HOSTNAME to enable)"
fi

bash "${ROOT_DIR}/ops/install/bin/40-verify.sh"

echo "[install-all] completed"
