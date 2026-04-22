#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  hb-runtime-audit.sh [--hours N] [--container NAME] [--strict] [--require-genesis]

Purpose:
  Quick operational audit for HyperBEAM runtime health over the last N hours.
  Designed to run directly on VPS host.

Examples:
  hb-runtime-audit.sh --hours 6
  hb-runtime-audit.sh --hours 24 --strict
USAGE
}

HOURS=6
CONTAINER="${HB_CONTAINER:-darkmesh-hyperbeam}"
STRICT=0
REQUIRE_GENESIS_WASM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours)
      HOURS="${2:-}"
      shift 2
      ;;
    --container)
      CONTAINER="${2:-}"
      shift 2
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --require-genesis)
      REQUIRE_GENESIS_WASM=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! [[ "$HOURS" =~ ^[0-9]+$ ]] || [[ "$HOURS" -lt 1 ]]; then
  echo "--hours must be a positive integer" >&2
  exit 2
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container not running: $CONTAINER" >&2
  exit 1
fi

SINCE="${HOURS}h"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LOG_FILE="$TMP_DIR/hb.log"
METRICS_FILE="$TMP_DIR/metrics.txt"

docker logs --since "$SINCE" "$CONTAINER" >"$LOG_FILE" 2>&1 || true
curl -fsS "http://127.0.0.1:8734/~hyperbuddy@1.0/metrics" >"$METRICS_FILE" 2>/dev/null || true

count_pat() {
  local pat="$1"
  grep -cE "$pat" "$LOG_FILE" 2>/dev/null || true
}

sum_metric() {
  local pat="$1"
  awk -v pat="$pat" '
    $0 ~ pat {
      val=$NF
      if (val ~ /^[0-9]+(\.[0-9]+)?$/) s += val
    }
    END { if (s == "") s=0; printf "%.0f\n", s }
  ' "$METRICS_FILE" 2>/dev/null || echo 0
}

error_reports="$(count_pat '=ERROR REPORT====')"
err_compute="$(count_pat 'error_computing_slot')"
no_route="$(count_pat 'no_viable_route')"
genesis_enoent="$(count_pat 'genesis-wasm-server/launch-monitored.sh')"
scheduler_timeout="$(count_pat 'scheduler_timeout')"
necessary_missing="$(count_pat 'necessary_message_not_found')"
cdn_not_found="$(count_pat 'body => \\{\"error\":\"not found\"\\}')"

metric_compute_error="$(sum_metric 'event\\{topic=\"compute_short\",event=\"error_computing_slot\"\\}')"
metric_hackney_error="$(sum_metric 'event\\{topic=\"http_client\",event=\"hackney_error\"\\}')"
metric_gun_econnrefused="$(sum_metric 'gun_requests_total\\{.*status_class=\"econnrefused\"')"
metric_cowboy_5xx="$(sum_metric 'cowboy_requests_total\\{.*status_class=\"server-error\"')"

nginx_5xx="$(awk -v h="$(date -u +%d/%b/%Y:)" '
  $0 ~ h && $9 ~ /^5/ { c++ }
  END { print c+0 }
' /var/log/nginx/hyperbeam.access.log 2>/dev/null || echo 0)"

launch_script_exists=0
if docker exec "$CONTAINER" sh -lc 'test -f /app/hb/genesis-wasm-server/launch-monitored.sh'; then
  launch_script_exists=1
fi

extract_route_target() {
  local needle="$1"
  docker exec "$CONTAINER" sh -lc 'cat /app/config.json' \
    | jq -r --arg needle "$needle" '
        (.routes // [])
        | map(select((.template // "") | contains($needle)))
        | .[0].node as $node
        | if $node == null then
            "missing"
          else
            ($node.with // $node.prefix // "missing")
          end
      ' 2>/dev/null || echo "missing"
}

result_route="$(extract_route_target "/result/")"
dry_run_route="$(extract_route_target "/dry-run")"

echo "HB runtime audit (window=${SINCE})"
echo "host=$(hostname) container=${CONTAINER} utc_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "Log counters:"
echo "  ERROR_REPORT=${error_reports}"
echo "  error_computing_slot=${err_compute}"
echo "  no_viable_route=${no_route}"
echo "  genesis_launch_enoent=${genesis_enoent}"
echo "  scheduler_timeout=${scheduler_timeout}"
echo "  necessary_message_not_found=${necessary_missing}"
echo "  upstream_not_found_body=${cdn_not_found}"
echo
echo "Metrics counters:"
echo "  compute_short_error_computing_slot=${metric_compute_error}"
echo "  http_client_hackney_error=${metric_hackney_error}"
echo "  gun_status_econnrefused=${metric_gun_econnrefused}"
echo "  cowboy_server_error=${metric_cowboy_5xx}"
echo "  nginx_5xx_today=${nginx_5xx}"
echo
echo "Runtime integrity:"
echo "  genesis_launch_script_present=${launch_script_exists}"
echo "  result_route_target=${result_route}"
echo "  dry_run_route_target=${dry_run_route}"

critical=0
if [[ "$REQUIRE_GENESIS_WASM" -eq 1 && "$launch_script_exists" -ne 1 ]]; then critical=1; fi
if [[ "$genesis_enoent" -gt 0 ]]; then critical=1; fi
if [[ "$no_route" -gt 0 ]]; then critical=1; fi
if [[ "$metric_gun_econnrefused" -gt 0 ]]; then critical=1; fi

if [[ "$critical" -eq 1 ]]; then
  echo
  echo "STATUS: CRITICAL issues detected."
  [[ "$STRICT" -eq 1 ]] && exit 1
else
  echo
  echo "STATUS: OK (no critical runtime blockers detected in window)."
fi
