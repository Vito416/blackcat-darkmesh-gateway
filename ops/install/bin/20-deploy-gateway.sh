#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "[deploy] run as root" >&2
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/Vito416/blackcat-darkmesh-gateway.git}"
REPO_REF="${REPO_REF:-main}"
SERVICE_USER="${SERVICE_USER:-blackcat}"
INSTALL_DIR="${INSTALL_DIR:-/opt/blackcat/gateway}"
ENV_FILE="${ENV_FILE:-/etc/blackcat/gateway.env}"

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  echo "[deploy] missing service user: $SERVICE_USER" >&2
  exit 1
fi

echo "[deploy] syncing repository: $REPO_URL @ $REPO_REF"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
  sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" fetch --all --tags --prune
  sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" checkout "$REPO_REF"
  sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_REF"
else
  rm -rf "$INSTALL_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$(dirname "$INSTALL_DIR")"
  sudo -u "$SERVICE_USER" git clone --branch "$REPO_REF" --single-branch "$REPO_URL" "$INSTALL_DIR"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$INSTALL_DIR/tmp"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" /var/log/blackcat

echo "[deploy] npm ci + build"
sudo -u "$SERVICE_USER" npm --prefix "$INSTALL_DIR" ci
sudo -u "$SERVICE_USER" npm --prefix "$INSTALL_DIR" run build

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[deploy] creating env file from template: $ENV_FILE"
  install -d -m 0750 -o root -g "$SERVICE_USER" /etc/blackcat
  install -m 0640 -o root -g "$SERVICE_USER" "$INSTALL_DIR/ops/install/env/gateway.env.example" "$ENV_FILE"
  echo "[deploy] edit $ENV_FILE and replace placeholders before live traffic"
fi

SERVICE_TEMPLATE="$INSTALL_DIR/ops/install/systemd/blackcat-gateway.service"
SERVICE_TARGET="/etc/systemd/system/blackcat-gateway.service"

sed \
  -e "s|__SERVICE_USER__|$SERVICE_USER|g" \
  -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$SERVICE_TEMPLATE" > "$SERVICE_TARGET"

systemctl daemon-reload
systemctl enable blackcat-gateway.service
systemctl restart blackcat-gateway.service

sleep 2
systemctl --no-pager --full status blackcat-gateway.service || true

echo "[deploy] done"
