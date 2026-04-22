#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  demo-domain-smoke.sh [--domains-file <path>] [--ao-base <url>] [--expect-marker <text>] <domain...>

Examples:
  demo-domain-smoke.sh demo-one.tld demo-two.tld
  demo-domain-smoke.sh --domains-file ops/live-vps/local-tools/demo-domains.example.txt --ao-base https://hyperbeam.darkmesh.fun
USAGE
}

DOMAINS_FILE=""
AO_BASE=""
EXPECT_MARKER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domains-file)
      DOMAINS_FILE="${2:-}"
      shift 2
      ;;
    --ao-base)
      AO_BASE="${2:-}"
      shift 2
      ;;
    --expect-marker)
      EXPECT_MARKER="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

declare -a DOMAINS=()

if [[ -n "${DOMAINS_FILE}" ]]; then
  if [[ ! -f "${DOMAINS_FILE}" ]]; then
    echo "Domains file not found: ${DOMAINS_FILE}" >&2
    exit 2
  fi
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "${line}" | tr -d '[:space:]')"
    [[ -z "${line}" ]] && continue
    DOMAINS+=("${line,,}")
  done < "${DOMAINS_FILE}"
fi

if [[ $# -gt 0 ]]; then
  for d in "$@"; do
    d="$(echo "${d}" | tr -d '[:space:]')"
    [[ -z "${d}" ]] && continue
    DOMAINS+=("${d,,}")
  done
fi

if [[ ${#DOMAINS[@]} -eq 0 ]]; then
  usage
  exit 2
fi

if [[ -n "${AO_BASE}" ]]; then
  AO_BASE="${AO_BASE%/}"
fi

pass=0
warn=0
fail=0

is_ok_root_code() {
  case "$1" in
    200|301|302|307|308) return 0 ;;
    *) return 1 ;;
  esac
}

check_site_by_host() {
  local domain="$1"
  local out http
  out="$(mktemp)"
  http="$(curl -sS -o "${out}" -w '%{http_code}' -X POST "${AO_BASE}/api/public/site-by-host" -H 'content-type: application/json' --data "{\"host\":\"${domain}\"}" || true)"

  if [[ "${http}" == "200" ]]; then
    if jq -e '.status == "OK" and .payload.siteId and .payload.siteId != ""' "${out}" >/dev/null 2>&1; then
      echo "  [PASS] AO site-by-host: bound"
      pass=$((pass + 1))
    else
      echo "  [WARN] AO site-by-host: HTTP 200 but unexpected payload"
      warn=$((warn + 1))
    fi
  elif [[ "${http}" == "404" ]]; then
    echo "  [FAIL] AO site-by-host: NOT_FOUND (host not bound)"
    fail=$((fail + 1))
  else
    echo "  [WARN] AO site-by-host: HTTP ${http}"
    warn=$((warn + 1))
  fi

  rm -f "${out}"
}

for domain in "${DOMAINS[@]}"; do
  echo
  echo "== ${domain} =="

  if command -v dig >/dev/null 2>&1; then
    cname="$(dig +short CNAME "${domain}" | sed 's/\.$//' | tail -n1 || true)"
    if [[ -n "${cname}" ]]; then
      echo "  [INFO] DNS CNAME: ${cname}"
    else
      echo "  [INFO] DNS CNAME: <none> (likely apex flattening/proxy)"
    fi
  fi

  body="$(mktemp)"
  code="$(curl -sS -L --max-time 25 -o "${body}" -w '%{http_code}' "https://${domain}/" || true)"

  if is_ok_root_code "${code}"; then
    echo "  [PASS] HTTPS / root: HTTP ${code}"
    pass=$((pass + 1))

    if [[ -n "${EXPECT_MARKER}" ]]; then
      if grep -Fqi "${EXPECT_MARKER}" "${body}"; then
        echo "  [PASS] marker found: ${EXPECT_MARKER}"
        pass=$((pass + 1))
      else
        echo "  [WARN] marker missing: ${EXPECT_MARKER}"
        warn=$((warn + 1))
      fi
    fi
  else
    echo "  [FAIL] HTTPS / root: HTTP ${code}"
    fail=$((fail + 1))
  fi

  rm -f "${body}"

  meta_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${domain}/~meta@1.0/info" || true)"
  if [[ "${meta_code}" == "200" ]]; then
    echo "  [PASS] HB meta endpoint: HTTP 200"
    pass=$((pass + 1))
  else
    echo "  [WARN] HB meta endpoint: HTTP ${meta_code}"
    warn=$((warn + 1))
  fi

  if [[ -n "${AO_BASE}" ]]; then
    check_site_by_host "${domain}"
  fi

done

echo
printf 'Summary: PASS=%d WARN=%d FAIL=%d\n' "${pass}" "${warn}" "${fail}"

if [[ ${fail} -gt 0 ]]; then
  exit 1
fi
