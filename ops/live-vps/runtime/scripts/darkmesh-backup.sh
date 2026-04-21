#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f /etc/darkmesh/backup.env ]]; then
  echo "missing /etc/darkmesh/backup.env" >&2
  exit 2
fi

set -a
# shellcheck source=/dev/null
source /etc/darkmesh/backup.env
set +a

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

BACKUP_ID="darkmesh-$(date -u +%Y%m%dT%H%M%SZ)"

echo "[backup] repo=${RESTIC_REPOSITORY} id=${BACKUP_ID}"
restic snapshots >/dev/null 2>&1 || restic init

restic backup \
  --tag darkmesh --tag vps --tag auto \
  --files-from /etc/darkmesh/backup.include \
  --exclude-file /etc/darkmesh/backup.exclude

restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
restic check --read-data-subset=5%

echo "[backup] done id=${BACKUP_ID}"
