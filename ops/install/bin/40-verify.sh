#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:8080/healthz}"
LOCAL_HEALTH_HOST_HEADER="${LOCAL_HEALTH_HOST_HEADER:-}"

if [[ -z "$LOCAL_HEALTH_HOST_HEADER" && -n "$PUBLIC_URL" ]]; then
  LOCAL_HEALTH_HOST_HEADER="$(printf '%s\n' "$PUBLIC_URL" | sed -E 's#^https?://([^/:]+).*$#\1#')"
fi

echo "[verify] gateway service"
systemctl is-active --quiet blackcat-gateway.service

echo "[verify] local health: ${LOCAL_HEALTH_URL}"
if [[ -n "$LOCAL_HEALTH_HOST_HEADER" ]]; then
  curl -fsS --max-time 10 -H "Host: ${LOCAL_HEALTH_HOST_HEADER}" "$LOCAL_HEALTH_URL" >/dev/null
else
  curl -fsS --max-time 10 "$LOCAL_HEALTH_URL" >/dev/null
fi

if systemctl list-unit-files | grep -q '^cloudflared.service'; then
  echo "[verify] cloudflared service"
  systemctl is-active --quiet cloudflared.service
fi

if [[ -n "$PUBLIC_URL" ]]; then
  echo "[verify] public health: ${PUBLIC_URL}/healthz"
  curl -fsS --max-time 15 "${PUBLIC_URL%/}/healthz" >/dev/null
fi

echo "[verify] ufw status"
ufw status verbose

echo "[verify] done"
