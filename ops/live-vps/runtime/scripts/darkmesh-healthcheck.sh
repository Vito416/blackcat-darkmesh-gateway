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

check_container_file() {
  local container="$1"
  local path="$2"
  local label="$3"
  if docker exec "$container" sh -lc "test -f \"$path\""; then
    log "OK file:$label"
  else
    log "FAIL file:$label"
    fail=1
  fi
}

check_hb_route_target() {
  local container="$1"
  local needle="$2"
  local expected="$3"
  local label="$4"
  local current

  current="$(
    docker exec "$container" sh -lc 'cat /app/config.json' \
      | jq -r --arg needle "$needle" '
          .routes
          | map(select(.template | contains($needle)))
          | .[0].node as $node
          | if $node == null then empty else ($node.with // $node.prefix // empty) end
        '
  )"

  if [[ -n "$current" && "$current" == "$expected"* ]]; then
    log "OK route:$label:$current"
  else
    log "FAIL route:$label:${current:-missing}"
    fail=1
  fi
}

check_service tailscaled
check_service ufw
check_service docker
check_service cloudflared-tunnel
check_service arweave-node

PUBLIC_ARWEAVE_URL="${DARKMESH_PUBLIC_ARWEAVE_URL:-https://arweave.example.com/info}"
PUBLIC_HB_ROOT_URL="${DARKMESH_PUBLIC_HB_ROOT_URL:-https://hyperbeam.example.com/}"
PUBLIC_HB_META_URL="${DARKMESH_PUBLIC_HB_META_URL:-https://hyperbeam.example.com/~meta@1.0/info}"
HB_CONTAINER="${DARKMESH_HB_CONTAINER:-darkmesh-hyperbeam}"
REQUIRE_GENESIS_WASM="${DARKMESH_REQUIRE_GENESIS_WASM:-0}"
RESULT_ROUTE_EXPECT="${DARKMESH_RESULT_ROUTE_EXPECT:-}"
DRY_RUN_ROUTE_EXPECT="${DARKMESH_DRY_RUN_ROUTE_EXPECT:-}"

check_http_json "http://127.0.0.1:1984/info" "arweave_local"
check_http_json "$PUBLIC_ARWEAVE_URL" "arweave_public"
check_http_code "$PUBLIC_HB_ROOT_URL" "hyperbeam_root"
check_http_code "$PUBLIC_HB_META_URL" "hyperbeam_meta"

if docker ps --format '{{.Names}}' | grep -qx "$HB_CONTAINER"; then
  if [[ "$REQUIRE_GENESIS_WASM" == "1" ]]; then
    check_container_file "$HB_CONTAINER" "/app/hb/genesis-wasm-server/launch-monitored.sh" "genesis_launch_script"
    check_container_file "$HB_CONTAINER" "/app/hb/genesis-wasm-server/package.json" "genesis_package"
  fi
  if [[ -n "$RESULT_ROUTE_EXPECT" ]]; then
    check_hb_route_target "$HB_CONTAINER" "/result/" "$RESULT_ROUTE_EXPECT" "result_route"
  fi
  if [[ -n "$DRY_RUN_ROUTE_EXPECT" ]]; then
    check_hb_route_target "$HB_CONTAINER" "/dry-run" "$DRY_RUN_ROUTE_EXPECT" "dry_run_route"
  fi
else
  log "FAIL container:$HB_CONTAINER not-running"
  fail=1
fi

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
