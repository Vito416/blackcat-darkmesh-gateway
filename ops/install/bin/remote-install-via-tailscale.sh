#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat >&2 <<'USAGE'
Usage:
  bash ops/install/bin/remote-install-via-tailscale.sh <tailscale-target> [repo-ref]

Examples:
  bash ops/install/bin/remote-install-via-tailscale.sh adminops@blackcat-gateway-vps
  bash ops/install/bin/remote-install-via-tailscale.sh adminops@blackcat-gateway-vps feat/gateway-p2-1-hardening-batch

Optional env:
  REPO_URL            default: https://github.com/Vito416/blackcat-darkmesh-gateway.git
  REPO_REF            default: current git branch (or main)
  SERVICE_USER        default: blackcat
  INSTALL_DIR         default: /opt/blackcat/gateway
  DISABLE_SSHD        default: 1
  ALLOW_TAILSCALE_SSH default: 1
  TUNNEL_ID           optional (for cloudflared wiring)
  TUNNEL_HOSTNAME     optional (for cloudflared wiring)
  PUBLIC_URL          optional (for public verify check)
USAGE
  exit 64
fi

TARGET="$1"
REPO_URL="${REPO_URL:-https://github.com/Vito416/blackcat-darkmesh-gateway.git}"
REPO_REF="${2:-${REPO_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}}"
SERVICE_USER="${SERVICE_USER:-blackcat}"
INSTALL_DIR="${INSTALL_DIR:-/opt/blackcat/gateway}"
DISABLE_SSHD="${DISABLE_SSHD:-1}"
ALLOW_TAILSCALE_SSH="${ALLOW_TAILSCALE_SSH:-1}"
TUNNEL_ID="${TUNNEL_ID:-}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-}"
PUBLIC_URL="${PUBLIC_URL:-}"
TAILSCALE_BIN="${TAILSCALE_BIN:-tailscale}"

if ! command -v "$TAILSCALE_BIN" >/dev/null 2>&1; then
  if [[ -x "/mnt/c/Program Files/Tailscale/tailscale.exe" ]]; then
    TAILSCALE_BIN="/mnt/c/Program Files/Tailscale/tailscale.exe"
  else
    echo "error: tailscale CLI not found (set TAILSCALE_BIN or install tailscale)" >&2
    exit 127
  fi
fi

q() {
  printf "%q" "$1"
}

REPO_URL_Q="$(q "$REPO_URL")"
REPO_REF_Q="$(q "$REPO_REF")"
SERVICE_USER_Q="$(q "$SERVICE_USER")"
INSTALL_DIR_Q="$(q "$INSTALL_DIR")"
DISABLE_SSHD_Q="$(q "$DISABLE_SSHD")"
ALLOW_TAILSCALE_SSH_Q="$(q "$ALLOW_TAILSCALE_SSH")"
TUNNEL_ID_Q="$(q "$TUNNEL_ID")"
TUNNEL_HOSTNAME_Q="$(q "$TUNNEL_HOSTNAME")"
PUBLIC_URL_Q="$(q "$PUBLIC_URL")"

cat <<EOF | "$TAILSCALE_BIN" ssh "$TARGET" "bash -s"
set -euo pipefail
REPO_URL=${REPO_URL_Q}
REPO_REF=${REPO_REF_Q}
SERVICE_USER=${SERVICE_USER_Q}
INSTALL_DIR=${INSTALL_DIR_Q}
DISABLE_SSHD=${DISABLE_SSHD_Q}
ALLOW_TAILSCALE_SSH=${ALLOW_TAILSCALE_SSH_Q}
TUNNEL_ID=${TUNNEL_ID_Q}
TUNNEL_HOSTNAME=${TUNNEL_HOSTNAME_Q}
PUBLIC_URL=${PUBLIC_URL_Q}

if ! command -v sudo >/dev/null 2>&1; then
  apt-get update
  apt-get install -y sudo
fi

sudo mkdir -p /opt/blackcat

if [[ ! -d "\${INSTALL_DIR}/.git" ]]; then
  sudo git clone --branch "\${REPO_REF}" --single-branch "\${REPO_URL}" "\${INSTALL_DIR}"
else
  sudo git -C "\${INSTALL_DIR}" fetch --all --tags --prune
  sudo git -C "\${INSTALL_DIR}" checkout "\${REPO_REF}"
  sudo git -C "\${INSTALL_DIR}" pull --ff-only origin "\${REPO_REF}"
fi

cd "\${INSTALL_DIR}"
sudo REPO_URL="\${REPO_URL}" REPO_REF="\${REPO_REF}" SERVICE_USER="\${SERVICE_USER}" INSTALL_DIR="\${INSTALL_DIR}" \\
  DISABLE_SSHD="\${DISABLE_SSHD}" ALLOW_TAILSCALE_SSH="\${ALLOW_TAILSCALE_SSH}" TUNNEL_ID="\${TUNNEL_ID}" \\
  TUNNEL_HOSTNAME="\${TUNNEL_HOSTNAME}" PUBLIC_URL="\${PUBLIC_URL}" \\
  bash ops/install/bin/install-all.sh
EOF
