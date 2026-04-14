#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:8080/healthz}"

echo "[verify] gateway service"
systemctl is-active --quiet blackcat-gateway.service

echo "[verify] local health: ${LOCAL_HEALTH_URL}"
curl -fsS --max-time 10 "$LOCAL_HEALTH_URL" >/dev/null

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
