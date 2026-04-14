#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "[harden] run as root" >&2
  exit 1
fi

DISABLE_SSHD="${DISABLE_SSHD:-1}"
ALLOW_TAILSCALE_SSH="${ALLOW_TAILSCALE_SSH:-1}"

echo "[harden] applying sysctl baseline"
cat > /etc/sysctl.d/99-blackcat-hardening.conf <<'SYSCTL'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.randomize_va_space = 2
SYSCTL
sysctl --system >/dev/null

echo "[harden] configuring firewall"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [[ "$ALLOW_TAILSCALE_SSH" == "1" ]]; then
  ufw allow in on tailscale0 to any port 22 proto tcp comment 'tailscale ssh only' >/dev/null || true
fi
ufw --force enable >/dev/null

if [[ "$DISABLE_SSHD" == "1" ]]; then
  echo "[harden] disabling public sshd service"
  systemctl disable --now ssh >/dev/null 2>&1 || true
  systemctl disable --now sshd >/dev/null 2>&1 || true
fi

echo "[harden] enabling unattended security upgrades"
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true

echo "[harden] done"
