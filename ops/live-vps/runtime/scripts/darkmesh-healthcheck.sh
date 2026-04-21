#!/usr/bin/env bash
set -euo pipefail

fail=0
log() { logger -t darkmesh-healthcheck "$*"; echo "$*"; }

check_service() {
  local svc="$1"
  if systemctl is-active --quiet "$svc"; then
    log "OK service:$svc"
  else
    log "FAIL service:$svc"
    fail=1
  fi
}

check_http_json() {
  local url="$1"
  local label="$2"
  if body=$(curl -fsS --max-time 12 "$url" 2>/dev/null); then
    if echo "$body" | jq -e '(.network | type == "string") and (.release | type == "number")' >/dev/null 2>&1; then
      log "OK http:$label"
    else
      log "FAIL http:$label json-shape"
      fail=1
    fi
  else
    log "FAIL http:$label connect"
    fail=1
  fi
}

check_http_code() {
  local url="$1"
  local label="$2"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 12 "$url" || true)
  case "$code" in
    200|301|302|303|307|308)
      log "OK code:$label:$code"
      ;;
    *)
      log "FAIL code:$label:$code"
      fail=1
      ;;
  esac
}

check_service tailscaled
check_service ufw
check_service docker
check_service cloudflared-tunnel
check_service arweave-node

PUBLIC_ARWEAVE_URL="${DARKMESH_PUBLIC_ARWEAVE_URL:-https://arweave.example.com/info}"
PUBLIC_HB_ROOT_URL="${DARKMESH_PUBLIC_HB_ROOT_URL:-https://hyperbeam.example.com/}"
PUBLIC_HB_META_URL="${DARKMESH_PUBLIC_HB_META_URL:-https://hyperbeam.example.com/~meta@1.0/info}"

check_http_json "http://127.0.0.1:1984/info" "arweave_local"
check_http_json "$PUBLIC_ARWEAVE_URL" "arweave_public"
check_http_code "$PUBLIC_HB_ROOT_URL" "hyperbeam_root"
check_http_code "$PUBLIC_HB_META_URL" "hyperbeam_meta"

# disk guardrail
usage_root=$(df --output=pcent / | tail -1 | tr -dc 0-9)
usage_data=$(df --output=pcent /srv/darkmesh/arweave-data | tail -1 | tr -dc 0-9)
if [ "$usage_root" -ge 90 ]; then log "FAIL disk:root:${usage_root}%"; fail=1; else log "OK disk:root:${usage_root}%"; fi
if [ "$usage_data" -ge 95 ]; then log "FAIL disk:arweave:${usage_data}%"; fail=1; else log "OK disk:arweave:${usage_data}%"; fi

if [ "$fail" -ne 0 ]; then
  log "HEALTHCHECK FAIL"
  exit 1
fi
log "HEALTHCHECK PASS"
