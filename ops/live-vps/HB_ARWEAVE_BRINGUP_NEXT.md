# HB + Arweave bring-up (applied runbook)

This is the concrete command sequence used on `65-109-99-102`.

## 1) Directory layout

```bash
sudo install -d -m 0755 /srv/darkmesh/{hb,arweave-data,releases}
sudo install -d -m 0755 /opt/arweave
sudo chown -R adminops:adminops /srv/darkmesh
```

## 2) Arweave binary install (non-mining)

```bash
cd /srv/darkmesh/releases
curl -fsSL https://api.github.com/repos/ArweaveTeam/arweave/releases/latest \
  | jq -r '.tag_name, (.assets[]?.browser_download_url // empty)'
curl -fsSLO https://github.com/ArweaveTeam/arweave/releases/download/N.2.9.5.1/arweave-2.9.5.1.ubuntu24.x86_64.tar.gz
tar -xzf arweave-2.9.5.1.ubuntu24.x86_64.tar.gz -C /opt/arweave
sudo ln -sfn /opt/arweave/arweave-2.9.5.1.ubuntu24.x86_64 /opt/arweave/current
```

## 3) Arweave systemd unit

Create `/etc/systemd/system/arweave-node.service`:

```ini
[Unit]
Description=Arweave node (non-mining)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=adminops
Group=adminops
WorkingDirectory=/opt/arweave/current
ExecStart=/opt/arweave/current/bin/start data_dir /srv/darkmesh/arweave-data peer peers.arweave.xyz
Restart=always
RestartSec=15
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/srv/darkmesh/arweave-data /opt/arweave

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arweave-node
sudo systemctl --no-pager status arweave-node
```

## 4) HyperBEAM (stock community Docker path)

```bash
cd /srv/darkmesh/hb
curl -fsSLo Dockerfile https://raw.githubusercontent.com/permaweb/HyperBEAM/feat/community-node/docs/community/Dockerfile
curl -fsSLo entrypoint.sh https://raw.githubusercontent.com/permaweb/HyperBEAM/feat/community-node/docs/community/entrypoint.sh
chmod +x entrypoint.sh
```

Create `/srv/darkmesh/hb/docker-compose.yml`:

```yaml
services:
  hyperbeam:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: darkmesh-hyperbeam
    network_mode: host
    restart: unless-stopped
    environment:
      ARWEAVE_NODE: http://127.0.0.1:1984
      HB_PORT: "8734"
      DATA_DIR: /data/rolling
      AUTO_INDEX: "false"
    volumes:
      - /srv/darkmesh/hb/data:/data
```

Start:

```bash
sudo docker compose -f /srv/darkmesh/hb/docker-compose.yml up --build -d
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

## 4b) Persist HB operator key (required for staking identity)

If you started HB without an explicit key mount, extract the generated key once and pin it:

```bash
sudo install -d -m 0700 /srv/darkmesh/hb/keys
sudo docker cp darkmesh-hyperbeam:/app/hb/hyperbeam-key.json /srv/darkmesh/hb/keys/hyperbeam-key.json
sudo chown root:root /srv/darkmesh/hb/keys/hyperbeam-key.json
sudo chmod 600 /srv/darkmesh/hb/keys/hyperbeam-key.json
```

Add this volume to `/srv/darkmesh/hb/docker-compose.yml`:

```yaml
    volumes:
      - /srv/darkmesh/hb/data:/data
      - /srv/darkmesh/hb/keys/hyperbeam-key.json:/app/hb/hyperbeam-key.json:ro
```

Then recreate:

```bash
sudo docker compose -f /srv/darkmesh/hb/docker-compose.yml up -d --force-recreate
sudo docker logs darkmesh-hyperbeam 2>&1 | grep -m1 "Operator:"
```

The shown `Operator:` address is the wallet identity you register/stake with in NASA.

## 5) Validation checks

```bash
# local
ss -ltnp | egrep '(:1984|:8734)'
curl -sS http://127.0.0.1:1984/info
curl -I http://127.0.0.1:8734/

# via tunnel
curl -sS https://arweave.<your-domain>/info
curl -I https://hyperbeam.<your-domain>
```

Expected today:

- `arweave.<your-domain>/info` returns JSON with `network=arweave.N.1`.
- `hyperbeam.<your-domain>` responds (`404` on `/` is acceptable baseline).
- `cloudflared-tunnel` is `active (running)` and connected (FRA PoPs in logs).

## 6) Known bring-up gotcha

If `AUTO_INDEX=true` during initial sync, Arweave can temporarily return `429 Too Many Requests`
to local HB copycat polling. Keep `AUTO_INDEX=false` until baseline stability is verified, then
enable intentionally for indexing tests.
