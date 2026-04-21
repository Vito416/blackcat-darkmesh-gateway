#!/usr/bin/env bash
set -euo pipefail

outdir="/srv/darkmesh/backups/config"
retention_days="${RETENTION_DAYS:-120}"

log() { logger -t darkmesh-config-prune "$*"; echo "$*"; }

if [[ ! -d "$outdir" ]]; then
  log "SKIP missing-dir:$outdir"
  exit 0
fi

count=0
while IFS= read -r archive; do
  [[ -n "$archive" ]] || continue
  sha="${archive}.sha256"
  rm -f -- "$archive"
  rm -f -- "$sha"
  count=$((count + 1))
  log "PRUNE deleted:$archive"
done < <(find "$outdir" -maxdepth 1 -type f -name 'darkmesh-config-*.tar.zst' -mtime +"$retention_days" -print | sort)

log "PRUNE done count=$count retention_days=$retention_days"
