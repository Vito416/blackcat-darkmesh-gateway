#!/usr/bin/env bash
set -u -o pipefail

BASE_URL="${1:-${BASE_URL:-https://gateway.blgateway.fun}}"
BASE_URL="${BASE_URL%/}"
SITE_ID="${SITE_ID:-site-alpha}"
SITE_PATH="${SITE_PATH:-/}"
READ_ACTION="${READ_ACTION:-public.resolve-route}"
TEMPLATE_TOKEN="${TEMPLATE_TOKEN:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-20}"
ACCEPT_TEMPLATE_CALL_504="${ACCEPT_TEMPLATE_CALL_504:-1}"

if [[ "${BASE_URL}" != http://* && "${BASE_URL}" != https://* ]]; then
  echo "[HARD-FAIL] BASE_URL must include http:// or https://, got: ${BASE_URL}" >&2
  exit 2
fi

declare -a JSON_HEADERS=("-H" "Content-Type: application/json")
if [[ -n "${TEMPLATE_TOKEN}" ]]; then
  JSON_HEADERS+=("-H" "x-template-token: ${TEMPLATE_TOKEN}")
fi

pass_count=0
warn_count=0
fail_count=0

tmp_files=()
cleanup() {
  local f
  for f in "${tmp_files[@]}"; do
    [[ -f "${f}" ]] && rm -f "${f}"
  done
}
trap cleanup EXIT

preview_body() {
  local file="$1"
  tr '\n' ' ' < "${file}" | sed 's/[[:space:]]\+/ /g' | cut -c1-220
}

record_pass() {
  pass_count=$((pass_count + 1))
  echo "PASS - $1"
}

record_warn() {
  warn_count=$((warn_count + 1))
  echo "WARN - $1"
}

record_fail() {
  fail_count=$((fail_count + 1))
  echo "FAIL - $1"
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local body_file err_file code

  body_file="$(mktemp)"
  err_file="$(mktemp)"
  tmp_files+=("${body_file}" "${err_file}")

  if [[ -n "${body}" ]]; then
    code="$(curl -sS --connect-timeout 8 --max-time "${CURL_TIMEOUT}" \
      -o "${body_file}" -w "%{http_code}" -X "${method}" \
      "${BASE_URL}${path}" "${JSON_HEADERS[@]}" --data "${body}" 2>"${err_file}")"
  else
    code="$(curl -sS --connect-timeout 8 --max-time "${CURL_TIMEOUT}" \
      -o "${body_file}" -w "%{http_code}" -X "${method}" \
      "${BASE_URL}${path}" 2>"${err_file}")"
  fi

  if [[ $? -ne 0 ]]; then
    local err_line
    err_line="$(head -n 1 "${err_file}" | tr '\n' ' ')"
    echo "::code=000::file=${body_file}::err=${err_line}"
    return
  fi

  echo "::code=${code}::file=${body_file}::err="
}

read_variant_entry() {
  local site_id="$1"
  local parsed

  if ! parsed="$(node - "${site_id}" <<'NODE'
const siteId = process.argv[2]
const raw = process.env.GATEWAY_TEMPLATE_VARIANT_MAP
if (!raw) {
  console.error('GATEWAY_TEMPLATE_VARIANT_MAP is required')
  process.exit(3)
}

let parsed
try {
  parsed = JSON.parse(raw)
} catch {
  console.error('GATEWAY_TEMPLATE_VARIANT_MAP must be valid JSON')
  process.exit(4)
}

const entry = parsed && typeof parsed === 'object' ? parsed[siteId] : null
if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
  console.error(`missing variant map entry for ${siteId}`)
  process.exit(5)
}

const variant = typeof entry.variant === 'string' ? entry.variant.trim() : ''
const templateTxId = typeof entry.templateTxId === 'string' ? entry.templateTxId.trim() : ''
const manifestTxId = typeof entry.manifestTxId === 'string' ? entry.manifestTxId.trim() : ''
if (!variant || !templateTxId || !manifestTxId) {
  console.error(`invalid variant map entry for ${siteId}`)
  process.exit(6)
}

process.stdout.write([variant, templateTxId, manifestTxId].join('\t'))
NODE
  )"; then
    return 1
  fi
  echo "${parsed}"
}

echo "prod-like site-variant smoke"
echo "BASE_URL=${BASE_URL}"
echo "SITE_ID=${SITE_ID}"
echo "SITE_PATH=${SITE_PATH}"
echo

if ! variant_entry="$(read_variant_entry "${SITE_ID}")"; then
  record_fail "GATEWAY_TEMPLATE_VARIANT_MAP must contain a valid entry for ${SITE_ID}"
  echo
  echo "Summary: PASS=${pass_count} WARN=${warn_count} FAIL=${fail_count}"
  exit 1
fi
variant="${variant_entry%%$'\t'*}"
remaining="${variant_entry#*$'\t'}"
template_txid="${remaining%%$'\t'*}"
manifest_txid="${remaining#*$'\t'}"
record_pass "variant map entry for ${SITE_ID} -> variant ${variant}, templateTxId ${template_txid}, manifestTxId ${manifest_txid}"

result="$(request "GET" "/template/config")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
if [[ "${code}" == "000" ]]; then
  record_fail "GET /template/config curl error: ${err_line}"
elif [[ "${code}" == "200" ]]; then
  if node - "${body_file}" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
let json
try {
  json = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  process.exit(2)
}
if (json?.ok !== true) process.exit(3)
if (json?.upstream?.variantMapConfigured !== true) process.exit(4)
if (json?.upstream?.readConfigured !== true) process.exit(5)
NODE
  then
    record_pass "GET /template/config -> 200 with readConfigured=true and variantMapConfigured=true"
  else
    record_fail "GET /template/config returned 200 but missing read-ready variant map fields; body=$(preview_body "${body_file}")"
  fi
else
  record_fail "GET /template/config expected 200, got ${code}; body=$(preview_body "${body_file}")"
fi

call_body="$(node - "${READ_ACTION}" "${SITE_ID}" "${SITE_PATH}" <<'NODE'
const [action, siteId, path] = process.argv.slice(2)
process.stdout.write(JSON.stringify({
  action,
  siteId,
  payload: {
    siteId,
    path,
  },
}))
NODE
)"

result="$(request "POST" "/template/call" "${call_body}")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
case "${code}" in
  000)
    record_fail "POST /template/call curl error: ${err_line}"
    ;;
  200|202|404)
    record_pass "POST /template/call -> ${code} (expected 200/202/404)"
    ;;
  504)
    if [[ "${ACCEPT_TEMPLATE_CALL_504}" == "1" ]]; then
      record_warn "POST /template/call -> 504 (upstream timeout tolerated in prod-like mode)"
    else
      record_fail "POST /template/call got 504; set ACCEPT_TEMPLATE_CALL_504=1 to tolerate"
    fi
    ;;
  *)
    record_fail "POST /template/call expected 200/202/404, got ${code}; body=$(preview_body "${body_file}")"
    ;;
esac

echo
echo "Summary: PASS=${pass_count} WARN=${warn_count} FAIL=${fail_count}"

if (( fail_count > 0 )); then
  exit 1
fi

exit 0
