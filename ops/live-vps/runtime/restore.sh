#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  restore.sh [--apply] [--reload-systemd] [--enable-healthcheck]
             [--enable-config-backup] [--enable-config-verify]
             [--enable-config-prune] [--enable-offsite-backup]
             [--start-core] [--help]

Defaults:
  - Dry-run mode (prints actions only)
  - Does not reload systemd and does not start/enable services

Options:
  --apply               Execute file copies and commands.
  --reload-systemd      Run `systemctl daemon-reload` after unit install.
  --enable-healthcheck  Enable+start darkmesh-healthcheck.timer.
  --enable-config-backup Enable+start darkmesh-config-backup.timer.
  --enable-config-verify Enable+start darkmesh-config-verify.timer.
  --enable-config-prune Enable+start darkmesh-config-prune.timer.
  --enable-offsite-backup Enable+start darkmesh-backup.timer (requires /etc/darkmesh/backup.env).
  --enable-backup-timer Legacy alias of --enable-offsite-backup.
  --start-core          Enable+start core services: arweave-node, cloudflared-tunnel.
  --help                Show this help.
EOF
}

APPLY=0
RELOAD_SYSTEMD=0
ENABLE_HEALTHCHECK=0
ENABLE_CONFIG_BACKUP=0
ENABLE_CONFIG_VERIFY=0
ENABLE_CONFIG_PRUNE=0
ENABLE_OFFSITE_BACKUP=0
START_CORE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --reload-systemd) RELOAD_SYSTEMD=1 ;;
    --enable-healthcheck) ENABLE_HEALTHCHECK=1 ;;
    --enable-config-backup) ENABLE_CONFIG_BACKUP=1 ;;
    --enable-config-verify) ENABLE_CONFIG_VERIFY=1 ;;
    --enable-config-prune) ENABLE_CONFIG_PRUNE=1 ;;
    --enable-offsite-backup|--enable-backup-timer) ENABLE_OFFSITE_BACKUP=1 ;;
    --start-core) START_CORE=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR"

if [[ ! -d "$RUNTIME_DIR/systemd" || ! -d "$RUNTIME_DIR/scripts" || ! -d "$RUNTIME_DIR/hb" ]]; then
  echo "Runtime directory structure is incomplete: $RUNTIME_DIR" >&2
  exit 1
fi

if [[ "$APPLY" -eq 1 && "$(id -u)" -ne 0 ]]; then
  echo "--apply requires root." >&2
  exit 1
fi

run() {
  if [[ "$APPLY" -eq 1 ]]; then
    "$@"
  else
    printf '[dry-run] '
    printf '%q ' "$@"
    printf '\n'
  fi
}

copy_file() {
  local src="$1"
  local dst="$2"
  local mode="$3"
  run install -D -m "$mode" "$src" "$dst"
}

echo "== Darkmesh runtime restore =="
echo "Runtime dir: $RUNTIME_DIR"
if [[ "$APPLY" -eq 0 ]]; then
  echo "Mode: dry-run (no changes)"
else
  echo "Mode: apply"
fi
echo

run install -d -m 0755 /etc/systemd/system
run install -d -m 0755 /usr/local/sbin
run install -d -m 0755 /srv/darkmesh/hb
run install -d -m 0755 /etc/cloudflared
run install -d -m 0750 /etc/darkmesh
run install -d -m 0755 /etc/nginx/sites-available

for unit in \
  arweave-node.service \
  cloudflared-tunnel.service \
  darkmesh-backup.service \
  darkmesh-backup.timer \
  darkmesh-config-backup.service \
  darkmesh-config-backup.timer \
  darkmesh-config-prune.service \
  darkmesh-config-prune.timer \
  darkmesh-config-verify.service \
  darkmesh-config-verify.timer \
  darkmesh-healthcheck-alert@.service \
  darkmesh-healthcheck.service \
  darkmesh-healthcheck.timer; do
  copy_file "$RUNTIME_DIR/systemd/$unit" "/etc/systemd/system/$unit" 0644
done

for script in \
  darkmesh-backup.sh \
  darkmesh-backup-config.sh \
  darkmesh-config-backup-prune.sh \
  darkmesh-backup-verify.sh \
  darkmesh-health-alert.sh \
  darkmesh-healthcheck.sh; do
  copy_file "$RUNTIME_DIR/scripts/$script" "/usr/local/sbin/$script" 0750
done

copy_file "$RUNTIME_DIR/hb/docker-compose.yml" "/srv/darkmesh/hb/docker-compose.yml" 0640
copy_file "$RUNTIME_DIR/hb/entrypoint.sh" "/srv/darkmesh/hb/entrypoint.sh" 0755
copy_file "$RUNTIME_DIR/hb/Dockerfile" "/srv/darkmesh/hb/Dockerfile" 0644
copy_file "$RUNTIME_DIR/nginx/hyperbeam-loopback.conf" "/etc/nginx/sites-available/hyperbeam-loopback.conf" 0644
copy_file "$RUNTIME_DIR/nginx/write-loopback.conf" "/etc/nginx/sites-available/write-loopback.conf" 0644

if [[ -f "$RUNTIME_DIR/etc/darkmesh/alerts.env.example" ]]; then
  copy_file "$RUNTIME_DIR/etc/darkmesh/alerts.env.example" "/etc/darkmesh/alerts.env.example" 0640
fi
if [[ "$APPLY" -eq 1 && ! -f /etc/darkmesh/alerts.env ]]; then
  run install -m 0640 "$RUNTIME_DIR/etc/darkmesh/alerts.env.example" /etc/darkmesh/alerts.env
fi

# optional legacy templates for encrypted offsite backup profile
if [[ -f "$RUNTIME_DIR/etc/darkmesh/backup.include" ]]; then
  copy_file "$RUNTIME_DIR/etc/darkmesh/backup.include" "/etc/darkmesh/backup.include" 0640
fi
if [[ -f "$RUNTIME_DIR/etc/darkmesh/backup.exclude" ]]; then
  copy_file "$RUNTIME_DIR/etc/darkmesh/backup.exclude" "/etc/darkmesh/backup.exclude" 0640
fi
if [[ -f "$RUNTIME_DIR/etc/darkmesh/backup.env.example" ]]; then
  copy_file "$RUNTIME_DIR/etc/darkmesh/backup.env.example" "/etc/darkmesh/backup.env.example" 0640
fi

copy_file "$RUNTIME_DIR/cloudflared/config.example.yml" "/etc/cloudflared/config.example.yml" 0640

if [[ "$APPLY" -eq 1 ]]; then
  if [[ ! -f /etc/cloudflared/config.yml ]]; then
    install -m 0640 "$RUNTIME_DIR/cloudflared/config.example.yml" /etc/cloudflared/config.yml
    echo "[info] created /etc/cloudflared/config.yml from example"
    echo "[warn] edit tunnel UUID + hostnames before starting cloudflared"
  else
    echo "[info] keeping existing /etc/cloudflared/config.yml"
  fi
else
  if [[ ! -f /etc/cloudflared/config.yml ]]; then
    echo "[dry-run] /etc/cloudflared/config.yml missing; would create from config.example.yml"
  else
    echo "[dry-run] /etc/cloudflared/config.yml exists; would keep it"
  fi
fi

if [[ "$APPLY" -eq 1 ]]; then
  ln -sfn /etc/nginx/sites-available/hyperbeam-loopback.conf /etc/nginx/sites-enabled/hyperbeam-loopback.conf
  ln -sfn /etc/nginx/sites-available/write-loopback.conf /etc/nginx/sites-enabled/write-loopback.conf
else
  echo "[dry-run] ln -sfn /etc/nginx/sites-available/hyperbeam-loopback.conf /etc/nginx/sites-enabled/hyperbeam-loopback.conf"
  echo "[dry-run] ln -sfn /etc/nginx/sites-available/write-loopback.conf /etc/nginx/sites-enabled/write-loopback.conf"
fi

if [[ "$RELOAD_SYSTEMD" -eq 1 ]]; then
  run systemctl daemon-reload
fi

if [[ "$START_CORE" -eq 1 ]]; then
  run systemctl enable --now arweave-node
  run systemctl enable --now cloudflared-tunnel
fi

if [[ "$ENABLE_HEALTHCHECK" -eq 1 ]]; then
  run systemctl enable --now darkmesh-healthcheck.timer
fi

if [[ "$ENABLE_CONFIG_BACKUP" -eq 1 ]]; then
  run systemctl enable --now darkmesh-config-backup.timer
fi

if [[ "$ENABLE_CONFIG_VERIFY" -eq 1 ]]; then
  run systemctl enable --now darkmesh-config-verify.timer
fi

if [[ "$ENABLE_CONFIG_PRUNE" -eq 1 ]]; then
  run systemctl enable --now darkmesh-config-prune.timer
fi

if [[ "$ENABLE_OFFSITE_BACKUP" -eq 1 ]]; then
  if [[ "$APPLY" -eq 1 ]]; then
    if [[ ! -f /etc/darkmesh/backup.env ]]; then
      echo "Missing /etc/darkmesh/backup.env. Create it first." >&2
      exit 1
    fi
    if ! grep -Eq '^RESTIC_REPOSITORY=.+$' /etc/darkmesh/backup.env; then
      echo "Missing RESTIC_REPOSITORY in /etc/darkmesh/backup.env." >&2
      exit 1
    fi
    if ! grep -Eq '^RESTIC_PASSWORD=.+$' /etc/darkmesh/backup.env; then
      echo "Missing RESTIC_PASSWORD in /etc/darkmesh/backup.env." >&2
      exit 1
    fi
  fi
  run systemctl enable --now darkmesh-backup.timer
fi

echo
echo "Done."
