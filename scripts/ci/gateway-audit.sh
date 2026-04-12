#!/usr/bin/env bash
set -u

MODE="${1:-all}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/ci/gateway-audit.sh [implementation|release|all]

Modes:
  implementation  Run implementation-health checks that should pass now.
  release         Run release/decommission closeout checks (can legitimately fail while AO/manual blockers remain).
  all             Run implementation and then release checks.
EOF
}

if [[ "${MODE}" != "implementation" && "${MODE}" != "release" && "${MODE}" != "all" ]]; then
  usage
  exit 64
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

FAIL=0

run_cmd() {
  echo "===== RUN: $*"
  "$@"
  local code=$?
  if [[ ${code} -eq 0 ]]; then
    echo "===== OK"
  else
    echo "===== FAIL(${code})"
    FAIL=1
  fi
  echo
}

run_implementation_checks() {
  run_cmd npm run build
  run_cmd npm test
  run_cmd npm run ops:validate-template-backend-contract -- --strict --json
  run_cmd npm run ops:validate-worker-secrets-trust-model -- --strict --json
  run_cmd npm run ops:validate-legacy-manifest -- --strict --json
  run_cmd npm run ops:check-legacy-runtime-boundary -- --strict --json
  run_cmd npm run ops:check-legacy-no-import-evidence -- --strict --json
  run_cmd npm run ops:check-legacy-core-extraction-evidence -- --strict --json
  run_cmd npm run ops:check-legacy-crypto-boundary-evidence -- --strict --json
  run_cmd npm run ops:validate-wedos-readiness -- --profile wedos_medium --env-file config/example.env --strict --json

  export GATEWAY_TEMPLATE_WORKER_URL_MAP
  export GATEWAY_TEMPLATE_WORKER_TOKEN_MAP
  export GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP
  GATEWAY_TEMPLATE_WORKER_URL_MAP="$(cat config/template-worker-routing.example.json)"
  GATEWAY_TEMPLATE_WORKER_TOKEN_MAP="$(cat config/template-worker-token-map.example.json)"
  GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP="$(cat config/template-worker-signature-ref-map.example.json)"

  run_cmd node scripts/check-template-worker-routing-config.js \
    --url-map "${GATEWAY_TEMPLATE_WORKER_URL_MAP}" \
    --token-map "${GATEWAY_TEMPLATE_WORKER_TOKEN_MAP}" \
    --strict \
    --json
  run_cmd node scripts/check-template-worker-map-coherence.js \
    --require-sites site-alpha,site-beta \
    --require-token-map \
    --require-signature-map \
    --strict \
    --json
  run_cmd node scripts/check-template-signature-ref-map.js \
    --require-sites site-alpha,site-beta \
    --strict \
    --json

  (
    set -a
    source config/forget-forward.example.env
    set +a
    run_cmd node scripts/check-forget-forward-config.js --strict --json
  )
}

run_release_checks() {
  run_cmd npm run ops:validate-ao-dependency-gate -- --file kernel-migration/ao-dependency-gate.json
  run_cmd npm run ops:check-ao-gate-evidence -- --file kernel-migration/ao-dependency-gate.json --strict --json
  run_cmd npm run ops:validate-final-migration-summary -- --file kernel-migration/FINAL_MIGRATION_SUMMARY.md --strict --json
  run_cmd npm run ops:validate-signoff-record -- --file kernel-migration/SIGNOFF_RECORD.md --strict --json
  run_cmd npm run ops:check-release-drill-artifacts -- --dir kernel-migration --strict --json
  run_cmd npm run ops:check-decommission-readiness -- --dir kernel-migration --ao-gate kernel-migration/ao-dependency-gate.json --strict --json
}

case "${MODE}" in
  implementation)
    run_implementation_checks
    ;;
  release)
    run_release_checks
    ;;
  all)
    run_implementation_checks
    run_release_checks
    ;;
esac

if [[ ${FAIL} -ne 0 ]]; then
  exit 3
fi

exit 0
