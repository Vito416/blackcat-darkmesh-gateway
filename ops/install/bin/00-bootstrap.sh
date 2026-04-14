#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "[bootstrap] run as root" >&2
  exit 1
fi

CODENAME="${VERSION_CODENAME:-}"
if [[ -z "$CODENAME" && -f /etc/os-release ]]; then
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
fi
if [[ -z "$CODENAME" ]]; then
  echo "[bootstrap] unable to detect Debian codename" >&2
  exit 1
fi

echo "[bootstrap] apt base packages"
apt-get update
apt-get install -y ca-certificates curl git jq gnupg ufw fail2ban unattended-upgrades apt-transport-https

NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [[ "$NODE_MAJOR" != "20" ]]; then
  echo "[bootstrap] installing Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[bootstrap] Node.js 20.x already present"
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "[bootstrap] installing tailscale"
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/${CODENAME}.noarmor.gpg" | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/${CODENAME}.tailscale-keyring.list" | tee /etc/apt/sources.list.d/tailscale.list
  apt-get update
  apt-get install -y tailscale
else
  echo "[bootstrap] tailscale already present"
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[bootstrap] installing cloudflared"
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared ${CODENAME} main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y cloudflared
else
  echo "[bootstrap] cloudflared already present"
fi

SERVICE_USER="${SERVICE_USER:-blackcat}"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  echo "[bootstrap] creating service user: $SERVICE_USER"
  adduser --system --group --home /opt/blackcat "$SERVICE_USER"
fi

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" /opt/blackcat
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" /opt/blackcat/gateway
install -d -m 0750 -o root -g "$SERVICE_USER" /etc/blackcat
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" /var/log/blackcat

echo "[bootstrap] done"
