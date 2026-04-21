#!/usr/bin/env bash
set -euo pipefail

log() { logger -t darkmesh-backup-verify "$*"; echo "$*"; }
fail() { log "FAIL $*"; exit 1; }

outdir="/srv/darkmesh/backups/config"
latest="$(ls -1t "$outdir"/darkmesh-config-*.tar.zst 2>/dev/null | head -n1 || true)"
[[ -n "$latest" ]] || fail "no backup archive found in $outdir"
sha="$latest.sha256"
[[ -f "$sha" ]] || fail "missing checksum file: $sha"

log "VERIFY archive=$latest"
sha256sum -c "$sha" >/dev/null || fail "sha256 mismatch"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

tar -xf "$latest" -C "$tmp" || fail "tar extract failed"

required=(
  "etc/cloudflared/config.yml"
  "etc/systemd/system/darkmesh-healthcheck.service"
  "etc/systemd/system/cloudflared-tunnel.service"
  "etc/ssh/sshd_config"
  "srv/darkmesh/hb/docker-compose.yml"
)

for rel in "${required[@]}"; do
  [[ -e "$tmp/$rel" ]] || fail "missing expected file in archive: $rel"
done

log "VERIFY PASS archive=$latest"
