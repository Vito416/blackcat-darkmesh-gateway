#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
HyperBEAM-first AO registry control-plane helper.

This script sends:
  1) RegisterSite
  2) BindDomain (for every host)

Primary endpoint defaults to hyperbeam.darkmesh.fun.
Push servers are used only as fallback.

Usage:
  registry-control-plane.sh \
    --pid <registry_pid> \
    --wallet <wallet.json> \
    --site-id <site_id> \
    --hosts <host1,host2,...> \
    [--primary-url <url>] \
    [--fallback-urls <url1,url2>] \
    [--actor-role <role>] \
    [--schema-version <version>] \
    [--site-version <version>] \
    [--request-prefix <prefix>] \
    [--bind-only]

Example:
  registry-control-plane.sh \
    --pid tIIt... \
    --wallet /secure/operator.json \
    --site-id site-jdwt \
    --hosts jdwt.fun,www.jdwt.fun
USAGE
}

PRIMARY_URL_DEFAULT="https://hyperbeam.darkmesh.fun"
FALLBACK_URLS_DEFAULT="https://push.forward.computer,https://push-1.forward.computer"
ACTOR_ROLE="registry-admin"
SCHEMA_VERSION="1.0"
SITE_VERSION="v1"
REQUEST_PREFIX="rid-regctl"

PID=""
WALLET=""
SITE_ID=""
HOSTS_RAW=""
PRIMARY_URL="${PRIMARY_URL_DEFAULT}"
FALLBACK_URLS="${FALLBACK_URLS_DEFAULT}"
BIND_ONLY="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pid)
      PID="${2:-}"
      shift 2
      ;;
    --wallet)
      WALLET="${2:-}"
      shift 2
      ;;
    --site-id)
      SITE_ID="${2:-}"
      shift 2
      ;;
    --hosts)
      HOSTS_RAW="${2:-}"
      shift 2
      ;;
    --primary-url)
      PRIMARY_URL="${2:-}"
      shift 2
      ;;
    --fallback-urls)
      FALLBACK_URLS="${2:-}"
      shift 2
      ;;
    --actor-role)
      ACTOR_ROLE="${2:-}"
      shift 2
      ;;
    --schema-version)
      SCHEMA_VERSION="${2:-}"
      shift 2
      ;;
    --site-version)
      SITE_VERSION="${2:-}"
      shift 2
      ;;
    --request-prefix)
      REQUEST_PREFIX="${2:-}"
      shift 2
      ;;
    --bind-only)
      BIND_ONLY="1"
      shift
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

if [[ -z "${PID}" || -z "${WALLET}" || -z "${SITE_ID}" || -z "${HOSTS_RAW}" ]]; then
  echo "Missing required args." >&2
  usage
  exit 2
fi

if [[ ! -f "${WALLET}" ]]; then
  echo "Wallet not found: ${WALLET}" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
WORKSPACE_ROOT="$(cd "${GATEWAY_REPO_ROOT}/.." && pwd)"
SEND_SCRIPT="${WORKSPACE_ROOT}/blackcat-darkmesh-ao/scripts/cli/send_ans104_scheduler.js"

if [[ ! -f "${SEND_SCRIPT}" ]]; then
  echo "AO sender script not found: ${SEND_SCRIPT}" >&2
  exit 2
fi

mapfile -t HOSTS < <(echo "${HOSTS_RAW}" | tr ',' '\n' | sed 's/[[:space:]]//g' | sed '/^$/d' | tr '[:upper:]' '[:lower:]')
if [[ ${#HOSTS[@]} -eq 0 ]]; then
  echo "No valid hosts parsed from --hosts" >&2
  exit 2
fi

declare -a URLS=()
URLS+=("${PRIMARY_URL%/}")
IFS=',' read -r -a FALLBACK_ITEMS <<< "${FALLBACK_URLS}"
for raw in "${FALLBACK_ITEMS[@]}"; do
  trimmed="$(echo "${raw}" | sed 's/[[:space:]]//g')"
  [[ -z "${trimmed}" ]] && continue
  URLS+=("${trimmed%/}")
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${GATEWAY_REPO_ROOT}/tmp/registry-control-plane-${SITE_ID}-${timestamp}"
mkdir -p "${RUN_DIR}"

sanitize() {
  echo "$1" | sed 's/[^a-zA-Z0-9._-]/_/g'
}

send_with_fallback() {
  local action="$1"
  local data_file="$2"
  local label="$3"

  local ok="0"
  for url in "${URLS[@]}"; do
    local out_file="${RUN_DIR}/out-$(sanitize "${label}")-$(sanitize "${action}")-$(sanitize "${url}").json"
    echo "-> ${action} via ${url}"
    if ! node "${SEND_SCRIPT}" \
      --pid "${PID}" \
      --url "${url}" \
      --wallet "${WALLET}" \
      --action "${action}" \
      --data-file "${data_file}" \
      --out "${out_file}"; then
      echo "   transport error on ${url}, trying next"
      continue
    fi

    if jq -e '.ok == true and (.status >= 200 and .status < 300)' "${out_file}" >/dev/null 2>&1; then
      echo "   success on ${url}"
      ok="1"
      break
    fi

    status="$(jq -r '.status // "unknown"' "${out_file}" 2>/dev/null || echo "unknown")"
    echo "   non-success status=${status} on ${url}, trying next"
  done

  if [[ "${ok}" != "1" ]]; then
    echo "All endpoints failed for ${action} (${label}). See ${RUN_DIR}" >&2
    return 1
  fi
}

req_base="${REQUEST_PREFIX}-${SITE_ID}-${timestamp}"

if [[ "${BIND_ONLY}" != "1" ]]; then
  register_payload="${RUN_DIR}/register-site.json"
  cat > "${register_payload}" <<EOF
{"Action":"RegisterSite","Request-Id":"${req_base}-register","Actor-Role":"${ACTOR_ROLE}","Schema-Version":"${SCHEMA_VERSION}","Site-Id":"${SITE_ID}","Config":{"version":"${SITE_VERSION}"}}
EOF
  send_with_fallback "RegisterSite" "${register_payload}" "register-${SITE_ID}"
fi

for host in "${HOSTS[@]}"; do
  bind_payload="${RUN_DIR}/bind-${host}.json"
  cat > "${bind_payload}" <<EOF
{"Action":"BindDomain","Request-Id":"${req_base}-bind-$(sanitize "${host}")","Actor-Role":"${ACTOR_ROLE}","Schema-Version":"${SCHEMA_VERSION}","Site-Id":"${SITE_ID}","Host":"${host}"}
EOF
  send_with_fallback "BindDomain" "${bind_payload}" "bind-${host}"
done

echo
echo "Done. Payloads + responses:"
echo "  ${RUN_DIR}"

