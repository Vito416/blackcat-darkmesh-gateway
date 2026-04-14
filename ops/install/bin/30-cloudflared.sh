#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "[cloudflared] run as root" >&2
  exit 1
fi

TUNNEL_ID="${TUNNEL_ID:-}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-}"
LOCAL_UPSTREAM="${LOCAL_UPSTREAM:-http://127.0.0.1:8080}"

if [[ -z "$TUNNEL_ID" || -z "$TUNNEL_HOSTNAME" ]]; then
  cat >&2 <<'USAGE'
[cloudflared] missing variables.
Set:
  TUNNEL_ID=<uuid>
  TUNNEL_HOSTNAME=<gateway.example.com>
Optional:
  LOCAL_UPSTREAM=http://127.0.0.1:8080

If tunnel is not created yet, run manually first:
  cloudflared tunnel login
  cloudflared tunnel create blackcat-gateway
  cloudflared tunnel route dns blackcat-gateway <gateway.example.com>
USAGE
  exit 1
fi

SOURCE_CREDS="/root/.cloudflared/${TUNNEL_ID}.json"
TARGET_DIR="/etc/cloudflared"
TARGET_CREDS="${TARGET_DIR}/${TUNNEL_ID}.json"
TARGET_CONFIG="${TARGET_DIR}/config.yml"

if [[ ! -f "$SOURCE_CREDS" ]]; then
  echo "[cloudflared] missing credentials: $SOURCE_CREDS" >&2
  exit 1
fi

install -d -m 0750 -o root -g root "$TARGET_DIR"
install -m 0600 -o root -g root "$SOURCE_CREDS" "$TARGET_CREDS"

cat > "$TARGET_CONFIG" <<CFG
tunnel: ${TUNNEL_ID}
credentials-file: ${TARGET_CREDS}
ingress:
  - hostname: ${TUNNEL_HOSTNAME}
    service: ${LOCAL_UPSTREAM}
  - service: http_status:404
CFG

cloudflared --config "$TARGET_CONFIG" tunnel ingress validate

cat > /etc/systemd/system/cloudflared.service <<'UNIT'
[Unit]
Description=cloudflared tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable cloudflared.service
systemctl restart cloudflared.service

sleep 2
systemctl --no-pager --full status cloudflared.service || true

echo "[cloudflared] done"
