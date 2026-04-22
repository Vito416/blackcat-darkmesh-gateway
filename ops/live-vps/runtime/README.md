# Runtime Templates

These files are host-runtime templates exported from the current VPS setup.

Use them as reproducible source when rebuilding a new node.

## One-command restore helper

Use `restore.sh` from this folder.

Dry-run first:

```bash
./restore.sh
```

Apply templates + reload systemd + enable healthcheck timer:

```bash
sudo ./restore.sh --apply --reload-systemd --enable-healthcheck
```

Optional: start core services (only after cloudflared config is valid):

```bash
sudo ./restore.sh --apply --reload-systemd --start-core
```

Enable config snapshot backup timer:

```bash
sudo ./restore.sh --apply --reload-systemd --enable-config-backup
```

Enable weekly config backup integrity verification timer:

```bash
sudo ./restore.sh --apply --reload-systemd --enable-config-verify
```

Enable weekly config backup prune timer (default retention 120 days):

```bash
sudo ./restore.sh --apply --reload-systemd --enable-config-prune
```

Enable encrypted offsite restic backup timer (after filling `/etc/darkmesh/backup.env`):

```bash
sudo ./restore.sh --apply --reload-systemd --enable-offsite-backup
```

Legacy alias still supported:

```bash
sudo ./restore.sh --apply --reload-systemd --enable-backup-timer
```

## Apply order (high-level)

1) Systemd units:
- copy from `runtime/systemd/` to `/etc/systemd/system/`
- run:
  - `systemctl daemon-reload`
  - `systemctl enable --now <unit>`

2) Scripts:
- copy `runtime/scripts/darkmesh-*.sh` to `/usr/local/sbin/`
- set executable: `chmod 750 /usr/local/sbin/darkmesh-*.sh`

3) HyperBEAM compose:
- copy `runtime/hb/docker-compose.yml` + `entrypoint.sh` + `Dockerfile` to `/srv/darkmesh/hb/`
- run `docker compose up -d --build`
- runtime Dockerfile is intentionally stock/minimal (default `rebar3 release`).
- delegated-compute routes default to `REMOTE_GATEWAY` (`arweave.net`) unless explicitly overridden.

4) Cloudflared:
- copy `runtime/cloudflared/config.example.yml` to `/etc/cloudflared/config.yml`
- replace placeholders (`YOUR_TUNNEL_UUID`, hostnames)
- ensure credentials file exists at `/root/.cloudflared/`
- default template expects:
  - `hyperbeam.<domain>` -> `127.0.0.1:8744` (read/frontend loopback)
  - `write.<domain>` -> `127.0.0.1:8734` (direct control-plane)
  - `arweave.<domain>` -> `127.0.0.1:1984`
- optional strict write-guard mode:
  - set `write.<domain>` -> `127.0.0.1:8745`
  - enable `runtime/nginx/write-loopback.conf`

5) Nginx loopback:
- copy `runtime/nginx/hyperbeam-loopback.conf` to `/etc/nginx/sites-available/`
- copy `runtime/nginx/write-loopback.conf` to `/etc/nginx/sites-available/`
- enable site and reload nginx if not already enabled on host.

## Security note

Do not store live secrets in this folder. Keep only templates/examples.

## Runtime audit helper

For quick post-deploy error scans on host:

```bash
sudo /usr/local/sbin/hb-runtime-audit.sh --hours 6 --strict
```
