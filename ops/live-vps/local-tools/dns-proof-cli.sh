#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
DNS proof helper (v1 draft).

Commands:
  generate  Produce TXT proof record content.
  verify    Verify TXT proof record exists and matches expected values.

Generate:
  dns-proof-cli.sh generate --domain <domain> --site-id <site_id> --owner <owner_wallet>

Verify:
  dns-proof-cli.sh verify --domain <domain> --site-id <site_id> --owner <owner_wallet> --challenge <challenge>

Notes:
  - TXT name is always _darkmesh.<domain>
  - This helper is for onboarding checks, not per-request runtime auth.
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

cmd="$1"
shift

DOMAIN=""
SITE_ID=""
OWNER=""
CHALLENGE=""
ISSUED=""
TTL_SECONDS="900"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --site-id)
      SITE_ID="${2:-}"
      shift 2
      ;;
    --owner)
      OWNER="${2:-}"
      shift 2
      ;;
    --challenge)
      CHALLENGE="${2:-}"
      shift 2
      ;;
    --issued)
      ISSUED="${2:-}"
      shift 2
      ;;
    --ttl-seconds)
      TTL_SECONDS="${2:-}"
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

if [[ -z "${DOMAIN}" || -z "${SITE_ID}" || -z "${OWNER}" ]]; then
  echo "Missing required args (--domain, --site-id, --owner)." >&2
  exit 2
fi

DOMAIN="$(echo "${DOMAIN}" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//')"
TXT_NAME="_darkmesh.${DOMAIN}"

if [[ "${cmd}" == "generate" ]]; then
  if [[ -z "${CHALLENGE}" ]]; then
    CHALLENGE="$(openssl rand -hex 16 2>/dev/null || true)"
  fi
  if [[ -z "${CHALLENGE}" ]]; then
    CHALLENGE="$(date +%s)-$RANDOM-$RANDOM"
  fi
  if [[ -z "${ISSUED}" ]]; then
    ISSUED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  EXPIRES="$(date -u -d "${ISSUED} + ${TTL_SECONDS} seconds" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
  if [[ -z "${EXPIRES}" ]]; then
    EXPIRES="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  TXT_VALUE="v=dm1;site=${SITE_ID};owner=${OWNER};challenge=${CHALLENGE};issued=${ISSUED};expires=${EXPIRES}"

  echo "TXT_NAME=${TXT_NAME}"
  echo "TXT_VALUE=${TXT_VALUE}"
  echo
  echo "Cloudflare quick setup:"
  echo "  Type: TXT"
  echo "  Name: _darkmesh"
  echo "  Content: ${TXT_VALUE}"
  echo "  TTL: Auto"
  exit 0
fi

if [[ "${cmd}" == "verify" ]]; then
  if ! command -v dig >/dev/null 2>&1; then
    echo "dig is required for verify mode (install dnsutils)" >&2
    exit 2
  fi

  if [[ -z "${CHALLENGE}" ]]; then
    echo "verify mode requires --challenge" >&2
    exit 2
  fi

  expected_site="site=${SITE_ID}"
  expected_owner="owner=${OWNER}"
  expected_challenge="challenge=${CHALLENGE}"

  raw="$(dig +short TXT "${TXT_NAME}" | tr -d '"' | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  if [[ -z "${raw}" ]]; then
    echo "FAIL: no TXT found for ${TXT_NAME}" >&2
    exit 1
  fi

  echo "TXT_FOUND=${raw}"

  for needle in "${expected_site}" "${expected_owner}" "${expected_challenge}" "v=dm1"; do
    if ! grep -Fq "${needle}" <<< "${raw}"; then
      echo "FAIL: missing token '${needle}' in TXT record" >&2
      exit 1
    fi
  done

  echo "PASS: DNS proof verified for ${DOMAIN}"
  exit 0
fi

echo "Unknown command: ${cmd}" >&2
usage
exit 2
