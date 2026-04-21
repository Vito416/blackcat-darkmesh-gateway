# Git Restore Matrix (what we do NOT need to back up online)

This matrix defines what can be recreated from git/network vs. what must stay in offline key escrow.

## A) Rebuild from network (no backup)

- Arweave chain/index/cache data:
  - `/srv/darkmesh/arweave-data/**` (except `wallets/`)
- HyperBEAM rolling/index store:
  - `/srv/darkmesh/hb/data/**`

Reason: deterministic re-sync from network, very large, low backup value.

## B) Restore from git (no secret backup needed)

Tracked runtime templates:
- `ops/live-vps/runtime/systemd/*.service`
- `ops/live-vps/runtime/systemd/*.timer`
- `ops/live-vps/runtime/scripts/darkmesh-*.sh`
- `ops/live-vps/runtime/hb/docker-compose.yml`
- `ops/live-vps/runtime/hb/entrypoint.sh`
- `ops/live-vps/runtime/cloudflared/config.example.yml`
- `ops/live-vps/runtime/etc/darkmesh/*`
- `ops/live-vps/runtime/restore.sh`

Operational docs:
- `ops/live-vps/*.md`

Reason: source-of-truth in repository.

## C) Secrets (offline escrow only, never in online backups)

- HB operator key:
  - `/srv/darkmesh/hb/keys/hyperbeam-key.json`
- Arweave node key:
  - `/srv/darkmesh/arweave-data/wallets/*.json`
- Cloudflared tunnel credentials:
  - `/root/.cloudflared/*.json`
  - `/root/.cloudflared/cert.pem`

Reason: compromise risk is worse than restore convenience.

## D) Minimal online backup scope (safe profile)

Recommended online backup should include only non-secret runtime config:
- `/etc/darkmesh` (excluding `/etc/darkmesh/backup.env`)
- `/etc/cloudflared/config.yml`
- `/etc/systemd/system/{arweave-node,cloudflared-tunnel,darkmesh-*}.{service,timer}`
- `/usr/local/sbin/darkmesh-*.sh`
- `/srv/darkmesh/hb/docker-compose.yml`

This is enough for fast infra rebuild while keeping keys offline.
