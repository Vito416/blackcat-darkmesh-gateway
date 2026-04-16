#!/usr/bin/env bash
set -euo pipefail

PRIMARY_BASE_URL="${1:-${PRIMARY_BASE_URL:-https://gateway.blgateway.fun}}"
SECONDARY_BASE_URL="${2:-${SECONDARY_BASE_URL:-}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOOLS_DIR="${ROOT_DIR}/ops/live-vps/local-tools"

echo "prodlike-full-suite"
echo "primary:   ${PRIMARY_BASE_URL}"
if [[ -n "${SECONDARY_BASE_URL}" ]]; then
  echo "secondary: ${SECONDARY_BASE_URL}"
else
  echo "secondary: <skipped>"
fi
echo

echo "[1/3] smoke (primary)"
bash "${TOOLS_DIR}/prodlike-smoke.sh" "${PRIMARY_BASE_URL}"
echo

echo "[2/3] deep check (primary)"
bash "${TOOLS_DIR}/prodlike-deep-check.sh" "${PRIMARY_BASE_URL}"
echo

if [[ -n "${SECONDARY_BASE_URL}" ]]; then
  echo "[3/3] deep check (secondary)"
  bash "${TOOLS_DIR}/prodlike-deep-check.sh" "${SECONDARY_BASE_URL}"
  echo
fi

echo "prodlike-full-suite: DONE"
