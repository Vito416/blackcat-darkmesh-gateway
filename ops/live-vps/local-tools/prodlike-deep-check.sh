#!/usr/bin/env bash
set -u -o pipefail

BASE_URL="${1:-${BASE_URL:-https://gateway.blgateway.fun}}"
BASE_URL="${BASE_URL%/}"
CURL_TIMEOUT="${CURL_TIMEOUT:-20}"
TEMPLATE_TOKEN="${TEMPLATE_TOKEN:-}"
METRICS_BEARER_TOKEN="${METRICS_BEARER_TOKEN:-}"
READ_ACTION="${READ_ACTION:-public.resolve-route}"
READ_PAYLOAD="${READ_PAYLOAD:-{\"siteId\":\"site-alpha\",\"path\":\"/\"}}"
ACCEPT_TEMPLATE_READ_504="${ACCEPT_TEMPLATE_READ_504:-1}"

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
  tr "\n" " " < "${file}" | sed "s/[[:space:]]\+/ /g" | cut -c1-220
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

echo "prod-like deep check"
echo "BASE_URL=${BASE_URL}"
echo "CURL_TIMEOUT=${CURL_TIMEOUT}s"
echo

# 1) Health
result="$(request "GET" "/healthz")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
if [[ "${code}" == "000" ]]; then
  record_fail "GET /healthz curl error: ${err_line}"
elif [[ "${code}" == "200" ]]; then
  record_pass "GET /healthz -> 200"
else
  record_fail "GET /healthz expected 200, got ${code}; body=$(preview_body "${body_file}")"
fi

# 2) Config
result="$(request "GET" "/template/config")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
if [[ "${code}" == "000" ]]; then
  record_fail "GET /template/config curl error: ${err_line}"
elif [[ "${code}" == "200" ]]; then
  record_pass "GET /template/config -> 200"
else
  record_fail "GET /template/config expected 200, got ${code}; body=$(preview_body "${body_file}")"
fi

# 3) Read call
result="$(request "POST" "/template/call" "{\"action\":\"${READ_ACTION}\",\"payload\":${READ_PAYLOAD}}")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
case "${code}" in
  000)
    record_fail "POST /template/call (read) curl error: ${err_line}"
    ;;
  200|202|404)
    record_pass "POST /template/call (read) -> ${code}"
    ;;
  504)
    if [[ "${ACCEPT_TEMPLATE_READ_504}" == "1" ]]; then
      record_warn "POST /template/call (read) -> 504 (upstream timeout tolerated in prod-like mode)"
    else
      record_fail "POST /template/call (read) got 504; set ACCEPT_TEMPLATE_READ_504=1 to tolerate"
    fi
    ;;
  *)
    record_fail "POST /template/call (read) expected 200/202/404, got ${code}; body=$(preview_body "${body_file}")"
    ;;
esac

# 4) Unknown action hard-block
result="$(request "POST" "/template/call" "{\"action\":\"totally.unknown.action\",\"payload\":{}}")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
if [[ "${code}" == "000" ]]; then
  record_fail "POST /template/call unknown action curl error: ${err_line}"
elif [[ "${code}" == "403" ]]; then
  record_pass "POST /template/call unknown action -> 403"
else
  record_fail "POST /template/call unknown action expected 403, got ${code}; body=$(preview_body "${body_file}")"
fi

# 5) Query rejection
result="$(request "GET" "/template/config?probe=1")"
code="${result#*::code=}"
code="${code%%::*}"
body_file="${result##*::file=}"
body_file="${body_file%%::*}"
err_line="${result##*::err=}"
if [[ "${code}" == "000" ]]; then
  record_fail "GET /template/config?probe=1 curl error: ${err_line}"
elif [[ "${code}" == "400" ]]; then
  record_pass "GET /template/config?probe=1 -> 400"
elif [[ "${code}" == "200" ]]; then
  record_warn "GET /template/config?probe=1 -> 200 (query passthrough enabled)"
else
  record_fail "GET /template/config?probe=1 expected 400, got ${code}; body=$(preview_body "${body_file}")"
fi

# 6) Content-type enforcement
body_file="$(mktemp)"
err_file="$(mktemp)"
tmp_files+=("${body_file}" "${err_file}")
code="$(curl -sS --connect-timeout 8 --max-time "${CURL_TIMEOUT}" \
  -o "${body_file}" -w "%{http_code}" -X POST \
  "${BASE_URL}/template/call" \
  -H "Content-Type: text/plain" \
  --data "not-json" 2>"${err_file}")"
if [[ $? -ne 0 ]]; then
  record_fail "POST /template/call text/plain curl error: $(head -n 1 "${err_file}")"
elif [[ "${code}" == "415" ]]; then
  record_pass "POST /template/call text/plain -> 415"
elif [[ "${code}" == "400" && "$(preview_body "${body_file}")" == *"invalid_json"* ]]; then
  record_pass "POST /template/call text/plain -> 400 invalid_json"
else
  record_fail "POST /template/call text/plain expected 415 or 400 invalid_json, got ${code}; body=$(preview_body "${body_file}")"
fi

# 7) Metrics auth expectation
metrics_headers=()
if [[ -n "${METRICS_BEARER_TOKEN}" ]]; then
  metrics_headers=(-H "Authorization: Bearer ${METRICS_BEARER_TOKEN}")
fi
body_file="$(mktemp)"
err_file="$(mktemp)"
tmp_files+=("${body_file}" "${err_file}")
code="$(curl -sS --connect-timeout 8 --max-time "${CURL_TIMEOUT}" \
  -o "${body_file}" -w "%{http_code}" -X GET \
  "${BASE_URL}/metrics" "${metrics_headers[@]}" 2>"${err_file}")"
if [[ $? -ne 0 ]]; then
  record_fail "GET /metrics curl error: $(head -n 1 "${err_file}")"
elif [[ -n "${METRICS_BEARER_TOKEN}" && "${code}" == "200" ]]; then
  record_pass "GET /metrics with bearer -> 200"
elif [[ -z "${METRICS_BEARER_TOKEN}" && ( "${code}" == "401" || "${code}" == "403" ) ]]; then
  record_pass "GET /metrics without bearer blocked -> ${code}"
elif [[ -z "${METRICS_BEARER_TOKEN}" && "${code}" == "200" ]]; then
  record_warn "GET /metrics is public (HTTP 200). Confirm this is intentional."
else
  record_fail "GET /metrics unexpected HTTP ${code}; body=$(preview_body "${body_file}")"
fi

echo
echo "Summary: PASS=${pass_count} WARN=${warn_count} FAIL=${fail_count}"

if (( fail_count > 0 )); then
  exit 1
fi

exit 0
