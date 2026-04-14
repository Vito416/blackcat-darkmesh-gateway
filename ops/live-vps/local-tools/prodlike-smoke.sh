#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-https://gateway.blgateway.fun}}"
BASE_URL="${BASE_URL%/}"
TEMPLATE_ACTION="${TEMPLATE_ACTION:-public.resolve-route}"
TEMPLATE_PAYLOAD="${TEMPLATE_PAYLOAD:-{\"siteId\":\"site-alpha\",\"path\":\"/\"}}"
TEMPLATE_TOKEN="${TEMPLATE_TOKEN:-}"
ACCEPT_TEMPLATE_CALL_504="${ACCEPT_TEMPLATE_CALL_504:-1}"

declare -a TEMPLATE_HEADERS=("-H" "Content-Type: application/json")
if [[ -n "${TEMPLATE_TOKEN}" ]]; then
  TEMPLATE_HEADERS+=("-H" "x-template-token: ${TEMPLATE_TOKEN}")
fi

tmp_body="$(mktemp)"
cleanup() {
  rm -f "${tmp_body}"
}
trap cleanup EXIT

echo "[1/3] healthz -> ${BASE_URL}/healthz"
curl -fsS "${BASE_URL}/healthz" | sed -n '1,120p'
echo

echo "[2/3] template config -> ${BASE_URL}/template/config"
curl -fsS "${BASE_URL}/template/config" | sed -n '1,200p'
echo

echo "[3/3] template call -> ${BASE_URL}/template/call"
http_code="$(curl -sS -o "${tmp_body}" -w "%{http_code}" \
  "${BASE_URL}/template/call" \
  "${TEMPLATE_HEADERS[@]}" \
  --data "{\"action\":\"${TEMPLATE_ACTION}\",\"payload\":${TEMPLATE_PAYLOAD}}")"
sed -n '1,220p' "${tmp_body}"
echo

case "${http_code}" in
  200|202|404)
    echo "prod-like smoke: OK (HTTP ${http_code})"
    ;;
  504)
    if [[ "${ACCEPT_TEMPLATE_CALL_504}" == "1" ]]; then
      echo "prod-like smoke: WARN (HTTP 504 upstream timeout tolerated)"
    else
      echo "prod-like smoke: FAILED (template call HTTP 504)" >&2
      exit 1
    fi
    ;;
  *)
    echo "prod-like smoke: FAILED (template call HTTP ${http_code})" >&2
    exit 1
    ;;
esac
