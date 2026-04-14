#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/run-live-strict-drill.sh [--dry-run] [--allow-anon] [--skip-forget-forward]

Environment (required):
  CONSISTENCY_URLS
  GATEWAY_TEMPLATE_WORKER_URL_MAP
  GATEWAY_TEMPLATE_WORKER_TOKEN_MAP
  GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP
  GATEWAY_TEMPLATE_VARIANT_MAP

Environment (required unless --allow-anon):
  GATEWAY_INTEGRITY_STATE_TOKEN

Environment (optional):
  GATEWAY_RESOURCE_PROFILE   default: vps_medium
  CONSISTENCY_MODE           default: pairwise
  RELEASE_VERSION            default: 1.4.0
  REQUIRED_TEMPLATE_SITES    default: site-alpha,site-beta
  AO_GATE_FILE               default: ops/decommission/ao-dependency-gate.json
  DRILL_DIR                  default: tmp/release-drills/live-<release>-<utcstamp>
  BOOTSTRAP_ENV_FILE         optional env file for validate-hosting-readiness
EOF
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: missing required environment variable: ${name}" >&2
    exit 64
  fi
}

run_cmd() {
  echo ">>> $*"
  if [[ "${DRY_RUN}" -eq 0 ]]; then
    "$@"
  fi
}

DRY_RUN=0
ALLOW_ANON=0
SKIP_FORGET_FORWARD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --allow-anon)
      ALLOW_ANON=1
      ;;
    --skip-forget-forward)
      SKIP_FORGET_FORWARD=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage
      exit 64
      ;;
  esac
  shift
done

GATEWAY_RESOURCE_PROFILE="${GATEWAY_RESOURCE_PROFILE:-vps_medium}"
CONSISTENCY_MODE="${CONSISTENCY_MODE:-pairwise}"
RELEASE_VERSION="${RELEASE_VERSION:-1.4.0}"
REQUIRED_TEMPLATE_SITES="${REQUIRED_TEMPLATE_SITES:-site-alpha,site-beta}"
AO_GATE_FILE="${AO_GATE_FILE:-ops/decommission/ao-dependency-gate.json}"
DRILL_DIR="${DRILL_DIR:-tmp/release-drills/live-${RELEASE_VERSION}-$(date -u +%Y%m%dT%H%M%SZ)}"

require_env CONSISTENCY_URLS
require_env GATEWAY_TEMPLATE_WORKER_URL_MAP
require_env GATEWAY_TEMPLATE_WORKER_TOKEN_MAP
require_env GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP
require_env GATEWAY_TEMPLATE_VARIANT_MAP

if [[ "${ALLOW_ANON}" -ne 1 ]]; then
  require_env GATEWAY_INTEGRITY_STATE_TOKEN
fi

echo "=== Live strict drill config ==="
echo "Release: ${RELEASE_VERSION}"
echo "Profile: ${GATEWAY_RESOURCE_PROFILE}"
echo "Mode: ${CONSISTENCY_MODE}"
echo "Required template sites: ${REQUIRED_TEMPLATE_SITES}"
echo "AO gate: ${AO_GATE_FILE}"
echo "Out dir: ${DRILL_DIR}"
echo "Allow anon: ${ALLOW_ANON}"
echo "Skip forget-forward check: ${SKIP_FORGET_FORWARD}"
echo "Dry run: ${DRY_RUN}"
echo

if [[ "${DRY_RUN}" -eq 0 ]]; then
  mkdir -p "${DRILL_DIR}"
fi

run_cmd npm run -s ops:validate-template-backend-contract -- --strict --json

if [[ -n "${BOOTSTRAP_ENV_FILE:-}" ]]; then
  run_cmd npm run -s ops:validate-hosting-readiness -- \
    --profile "${GATEWAY_RESOURCE_PROFILE}" \
    --env-file "${BOOTSTRAP_ENV_FILE}" \
    --strict --json
fi

run_cmd npm run -s ops:check-template-worker-routing-config -- \
  --url-map "${GATEWAY_TEMPLATE_WORKER_URL_MAP}" \
  --token-map "${GATEWAY_TEMPLATE_WORKER_TOKEN_MAP}" \
  --strict --json

run_cmd npm run -s ops:check-template-worker-map-coherence -- \
  --require-sites "${REQUIRED_TEMPLATE_SITES}" \
  --require-token-map \
  --require-signature-map \
  --strict --json

run_cmd npm run -s ops:check-template-signature-ref-map -- \
  --require-sites "${REQUIRED_TEMPLATE_SITES}" \
  --strict --json

run_cmd npm run -s ops:validate-template-variant-map-config -- \
  --strict \
  --require-sites "${REQUIRED_TEMPLATE_SITES}"

if [[ "${SKIP_FORGET_FORWARD}" -ne 1 ]]; then
  run_cmd npm run -s ops:check-forget-forward-config -- --strict --json
fi

preflight_args=(
  --urls "${CONSISTENCY_URLS}"
  --mode "${CONSISTENCY_MODE}"
  --profile "${GATEWAY_RESOURCE_PROFILE}"
)
drill_args=(
  --urls "${CONSISTENCY_URLS}"
  --out-dir "${DRILL_DIR}"
  --profile "${GATEWAY_RESOURCE_PROFILE}"
  --mode "${CONSISTENCY_MODE}"
  --release "${RELEASE_VERSION}"
  --strict
)

if [[ "${ALLOW_ANON}" -eq 1 ]]; then
  preflight_args+=(--allow-anon)
  drill_args+=(--allow-anon)
else
  preflight_args+=(--token "${GATEWAY_INTEGRITY_STATE_TOKEN}")
  drill_args+=(--token "${GATEWAY_INTEGRITY_STATE_TOKEN}")
fi

run_cmd npm run -s ops:validate-consistency-preflight -- "${preflight_args[@]}"
run_cmd npm run -s ops:run-release-drill -- "${drill_args[@]}"
run_cmd npm run -s ops:check-release-drill-artifacts -- --dir "${DRILL_DIR}" --strict --json
run_cmd npm run -s ops:check-decommission-readiness -- --dir "${DRILL_DIR}" --ao-gate "${AO_GATE_FILE}" --strict --json
run_cmd npm run -s ops:check-production-readiness -- --dir "${DRILL_DIR}" --ao-gate "${AO_GATE_FILE}" --json

echo
echo "Live strict drill finished."
echo "Artifacts: ${DRILL_DIR}"
