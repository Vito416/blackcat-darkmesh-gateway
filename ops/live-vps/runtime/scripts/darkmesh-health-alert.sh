#!/usr/bin/env bash
set -euo pipefail

unit_in="${1:-darkmesh-healthcheck.service}"
unit="$unit_in"
if ! systemctl list-unit-files --type=service --all | awk '{print $1}' | grep -qx "$unit"; then
  if [[ "$unit" != *.service ]] && systemctl list-unit-files --type=service --all | awk '{print $1}' | grep -qx "$unit.service"; then
    unit="$unit.service"
  fi
fi

host="$(hostname)"
ts_ip="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
result="$(systemctl show "$unit" -p Result --value 2>/dev/null | head -n1 || true)"
state="$(systemctl is-active "$unit" 2>/dev/null | head -n1 || true)"
[[ -n "$result" ]] || result="unknown"
[[ -n "$state" ]] || state="unknown"

now="$(date -Is)"
msg="[darkmesh-alert] unit=$unit result=$result state=$state host=$host ts_ip=${ts_ip:-n/a} at=$now"

logger -t darkmesh-alert "$msg"
printf "%s\n" "$msg"

if [[ -n "${WEBHOOK_URL:-}" ]]; then
  payload=$(jq -n \
    --arg text "$msg" \
    --arg unit "$unit" \
    --arg result "$result" \
    --arg state "$state" \
    --arg host "$host" \
    --arg ts_ip "${ts_ip:-}" \
    --arg ts "$now" \
    '{text:$text, unit:$unit, result:$result, state:$state, host:$host, tailscale_ip:$ts_ip, timestamp:$ts}')
  curl -fsS -X POST -H "Content-Type: application/json" --data "$payload" "$WEBHOOK_URL" >/dev/null || true
fi
