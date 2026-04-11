#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[integrity-gate] missing required command: $cmd" >&2
    exit 127
  fi
}

run_step() {
  local label="$1"
  shift
  echo "[integrity-gate] >>> ${label}"
  "$@"
  echo "[integrity-gate] <<< ${label} [ok]"
  STEPS_DONE=$((STEPS_DONE + 1))
}

on_error() {
  local exit_code=$?
  echo "[integrity-gate] <<< ${CURRENT_STEP:-unknown} [fail] exit=${exit_code}" >&2
  exit "$exit_code"
}

trap on_error ERR

CURRENT_STEP="preflight"
require_cmd npm
require_cmd npx

STEPS_DONE=0
STEPS_TOTAL=14
CURRENT_STEP=""

if [[ -f tests/integrity-transition-formal.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/validate-ao-dependency-gate.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/export-consistency-report.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/build-release-signoff-checklist.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/run-release-drill.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/profile-tuning-sync.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/check-release-drill-artifacts.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi
if [[ -f tests/build-release-evidence-ledger.test.ts ]]; then
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
fi

echo "[integrity-gate] starting ${STEPS_TOTAL} checks"

CURRENT_STEP="build"
run_step "$CURRENT_STEP" npm run build

CURRENT_STEP="integrity-verifier"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-verifier.test.ts

CURRENT_STEP="integrity-client"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-client.test.ts

CURRENT_STEP="integrity-checkpoint"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-checkpoint.test.ts

CURRENT_STEP="integrity-cache-enforcement"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-cache-enforcement.test.ts

CURRENT_STEP="integrity-parity"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-parity.test.ts

CURRENT_STEP="integrity-policy-gate"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-policy-gate.test.ts

CURRENT_STEP="integrity-incident"
run_step "$CURRENT_STEP" npx vitest run tests/integrity-incident.test.ts

if [[ -f tests/integrity-transition-formal.test.ts ]]; then
  CURRENT_STEP="integrity-transition-formal"
  run_step "$CURRENT_STEP" npx vitest run tests/integrity-transition-formal.test.ts
fi

if [[ -f tests/validate-ao-dependency-gate.test.ts ]]; then
  CURRENT_STEP="validate-ao-dependency-gate"
  run_step "$CURRENT_STEP" npx vitest run tests/validate-ao-dependency-gate.test.ts
fi

if [[ -f tests/export-consistency-report.test.ts ]]; then
  CURRENT_STEP="export-consistency-report"
  run_step "$CURRENT_STEP" npx vitest run tests/export-consistency-report.test.ts
fi

if [[ -f tests/build-release-signoff-checklist.test.ts ]]; then
  CURRENT_STEP="build-release-signoff-checklist"
  run_step "$CURRENT_STEP" npx vitest run tests/build-release-signoff-checklist.test.ts
fi

if [[ -f tests/run-release-drill.test.ts ]]; then
  CURRENT_STEP="run-release-drill"
  run_step "$CURRENT_STEP" npx vitest run tests/run-release-drill.test.ts
fi

if [[ -f tests/profile-tuning-sync.test.ts ]]; then
  CURRENT_STEP="profile-tuning-sync"
  run_step "$CURRENT_STEP" npx vitest run tests/profile-tuning-sync.test.ts
fi

if [[ -f tests/check-release-drill-artifacts.test.ts ]]; then
  CURRENT_STEP="check-release-drill-artifacts"
  run_step "$CURRENT_STEP" npx vitest run tests/check-release-drill-artifacts.test.ts
fi

if [[ -f tests/build-release-evidence-ledger.test.ts ]]; then
  CURRENT_STEP="build-release-evidence-ledger"
  run_step "$CURRENT_STEP" npx vitest run tests/build-release-evidence-ledger.test.ts
fi

CURRENT_STEP="fetch-control"
run_step "$CURRENT_STEP" npx vitest run tests/fetch-control.test.ts

CURRENT_STEP="resource-hardening"
run_step "$CURRENT_STEP" npx vitest run tests/resource-hardening.test.ts

CURRENT_STEP="rate-replay-limits"
run_step "$CURRENT_STEP" npx vitest run tests/rate-replay-limits.test.ts

CURRENT_STEP="budget-metrics"
run_step "$CURRENT_STEP" npx vitest run tests/budget-metrics.test.ts

CURRENT_STEP="metrics-auth"
run_step "$CURRENT_STEP" npx vitest run tests/metrics-auth.test.ts

CURRENT_STEP="webhook-pentest"
run_step "$CURRENT_STEP" npx vitest run tests/webhook-pentest.test.ts

echo "[integrity-gate] SUCCESS ${STEPS_DONE}/${STEPS_TOTAL} checks passed"
