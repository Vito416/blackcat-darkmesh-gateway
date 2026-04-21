#!/usr/bin/env bash
set -euo pipefail

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
outdir="/srv/darkmesh/backups/config"
archive="$outdir/darkmesh-config-$stamp.tar.zst"
sha="$archive.sha256"

tmp="$(mktemp -d)"
cleanup(){ rm -rf "$tmp"; }
trap cleanup EXIT

# selected reproducible config set (secrets intentionally excluded)
items=(
  /etc/cloudflared/config.yml
  /etc/systemd/system/cloudflared-tunnel.service
  /etc/systemd/system/darkmesh-healthcheck.service
  /etc/systemd/system/darkmesh-healthcheck.timer
  /etc/systemd/system/darkmesh-healthcheck-alert@.service
  /etc/darkmesh/alerts.env
  /usr/local/sbin/darkmesh-healthcheck.sh
  /usr/local/sbin/darkmesh-health-alert.sh
  /etc/nginx/sites-available/hyperbeam-loopback.conf
  /etc/ssh/sshd_config
  /etc/ssh/sshd_config.d/70-darkmesh-auth.conf
  /etc/ufw/user.rules
  /etc/ufw/user6.rules
  /srv/darkmesh/hb/docker-compose.yml
)

manifest="$tmp/manifest.txt"
: > "$manifest"
for p in "${items[@]}"; do
  if [[ -e "$p" ]]; then
    echo "$p" >> "$manifest"
  fi
done

# tar stores absolute paths as relative by stripping leading /
tar --zstd -cf "$archive" -T "$manifest" --transform=s,^/,,
sha256sum "$archive" > "$sha"

printf "BACKUP_ARCHIVE=%s\n" "$archive"
printf "BACKUP_SHA=%s\n" "$sha"
sha256sum -c "$sha"
