#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
HyperBEAM full-parity gate (read + control-plane write).

This gate MUST pass before claiming "full parity" for a new install.

Checks:
  1) read plane:      GET <hb-url>/~meta@1.0/info == 200
  2) write plane:     signed ANS104 POST to /~scheduler@1.0/schedule == 2xx
  3) scheduler proof: response headers include slot + process

Usage:
  hb-full-parity-gate.sh \
    --hb-url <https://hyperbeam.example.com> \
    --registry-pid <pid> \
    --wallet <wallet.json>

Example:
  hb-full-parity-gate.sh \
    --hb-url https://hyperbeam.darkmesh.fun \
    --registry-pid tIIt... \
    --wallet ../blackcat-darkmesh-write/wallet.json
USAGE
}

HB_URL=""
REGISTRY_PID=""
WALLET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hb-url)
      HB_URL="${2:-}"
      shift 2
      ;;
    --registry-pid)
      REGISTRY_PID="${2:-}"
      shift 2
      ;;
    --wallet)
      WALLET="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${HB_URL}" || -z "${REGISTRY_PID}" || -z "${WALLET}" ]]; then
  echo "Missing required args." >&2
  usage
  exit 2
fi

if [[ ! -f "${WALLET}" ]]; then
  echo "Wallet file not found: ${WALLET}" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
WORKSPACE_ROOT="$(cd "${GATEWAY_REPO_ROOT}/.." && pwd)"
SEND_SCRIPT="${WORKSPACE_ROOT}/blackcat-darkmesh-ao/scripts/cli/send_ans104_scheduler.js"

if [[ ! -f "${SEND_SCRIPT}" ]]; then
  echo "Sender script not found: ${SEND_SCRIPT}" >&2
  exit 2
fi

HB_URL="${HB_URL%/}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${GATEWAY_REPO_ROOT}/tmp/hb-full-parity-gate-${timestamp}"
mkdir -p "${OUT_DIR}"

echo "[1/2] Read-plane check: ${HB_URL}/~meta@1.0/info"
meta_status="$(curl -sS -o "${OUT_DIR}/meta-body.txt" -w '%{http_code}' "${HB_URL}/~meta@1.0/info" || true)"
echo "meta_status=${meta_status}" | tee "${OUT_DIR}/meta-status.txt"
if [[ "${meta_status}" != "200" ]]; then
  echo "FAIL: read-plane check failed (expected 200)" >&2
  echo "Artifacts: ${OUT_DIR}" >&2
  exit 1
fi

echo "[2/2] Control-plane scheduler check (signed ANS104 Ping)"
send_out="${OUT_DIR}/scheduler-send.json"
if ! node "${SEND_SCRIPT}" \
  --pid "${REGISTRY_PID}" \
  --url "${HB_URL}" \
  --wallet "${WALLET}" \
  --action "Ping" \
  --data '{}' \
  --out "${send_out}"; then
  echo "FAIL: scheduler send transport failed" >&2
  echo "Artifacts: ${OUT_DIR}" >&2
  exit 1
fi

status="$(jq -r '.status // 0' "${send_out}")"
slot="$(jq -r '.headers.slot // ""' "${send_out}")"
process="$(jq -r '.headers.process // ""' "${send_out}")"
ok="$(jq -r '.ok // false' "${send_out}")"

echo "scheduler_status=${status}" | tee "${OUT_DIR}/scheduler-status.txt"
echo "scheduler_ok=${ok}" >> "${OUT_DIR}/scheduler-status.txt"
echo "scheduler_slot=${slot}" >> "${OUT_DIR}/scheduler-status.txt"
echo "scheduler_process=${process}" >> "${OUT_DIR}/scheduler-status.txt"

if [[ "${ok}" != "true" ]] || [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
  echo "FAIL: scheduler endpoint is not parity-ready (non-2xx)" >&2
  echo "Artifacts: ${OUT_DIR}" >&2
  exit 1
fi

if [[ -z "${slot}" || -z "${process}" ]]; then
  echo "FAIL: scheduler accepted request but missing slot/process headers" >&2
  echo "Artifacts: ${OUT_DIR}" >&2
  exit 1
fi

echo "PASS: full parity gate passed."
echo "Artifacts: ${OUT_DIR}"

