#!/usr/bin/env bash
set -euo pipefail

# Pull latest VPS config backup over Tailscale SSH and verify checksum locally.
# Usage:
#   ./pull-latest-config-backup.sh [adminops@tailscale-ip-or-host] [out-dir]

HOST="${1:-${DARKMESH_BACKUP_HOST:-}}"
OUT_DIR="${2:-$HOME/Desktop/DARKMESH_VPS_BACKUPS}"
mkdir -p "$OUT_DIR"

mkdir -p "$HOME/.ssh"
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$HOME/.ssh/known_hosts")

if [[ -z "$HOST" ]]; then
  echo "Usage: $0 <adminops@tailscale-host-or-ip> [out-dir]" >&2
  echo "or set DARKMESH_BACKUP_HOST in environment." >&2
  exit 2
fi

latest="$(ssh "${ssh_opts[@]}" "$HOST" "sudo bash -lc 'ls -1t /srv/darkmesh/backups/config/darkmesh-config-*.tar.zst | head -n1'")"
if [[ -z "$latest" ]]; then
  echo "[pull] failed: no archive found on host" >&2
  exit 1
fi

base="$(basename "$latest")"
archive_local="$OUT_DIR/$base"
sha_local="$archive_local.sha256"
sha_check="$archive_local.local.sha256"

echo "[pull] host=$HOST"
echo "[pull] latest=$latest"

ssh "${ssh_opts[@]}" "$HOST" "sudo cat '$latest'" > "$archive_local"
ssh "${ssh_opts[@]}" "$HOST" "sudo cat '${latest}.sha256'" > "$sha_local"

expected_hash="$(awk '{print $1}' "$sha_local" | head -n1)"
if [[ -z "$expected_hash" ]]; then
  echo "[pull] failed: checksum file is empty or invalid" >&2
  exit 1
fi
printf "%s  %s\n" "$expected_hash" "$(basename "$archive_local")" > "$sha_check"
(cd "$OUT_DIR" && sha256sum -c "$(basename "$sha_check")")

echo "[pull] OK archive=$archive_local"
echo "[pull] OK sha=$sha_local"
