# Backup & Recovery Checklist (VPS)

Use this before production launch.

## Current state snapshot (2026-04-21)

- Implemented:
  - daily local config snapshot timer (`darkmesh-config-backup.timer`),
  - weekly local integrity verification timer (`darkmesh-config-verify.timer`).
  - weekly local retention prune timer (`darkmesh-config-prune.timer`, 120 days default).
- Still required before production:
  - encrypted offsite copy destination,
  - full offsite restore drill.
- Free mode note:
  - if staying fully free, use manual offsite uploads from local pull script and keep strict weekly cadence.

## A) Backup policy

- [ ] Define RPO/RTO target (example: RPO 24h, RTO 2h)
- [ ] Pick offsite backup target (S3/B2/other object store)
- [ ] Use client-side encryption for backups
- [ ] Keep backup credentials outside repo and outside VPS image backups

## B) What to back up (online backup profile)

- [ ] `/etc/darkmesh` (exclude `backup.env`)
- [ ] `/etc/cloudflared/config.yml` (config only)
- [ ] `/etc/systemd/system/` custom units (`arweave-node`, `cloudflared-tunnel`, `darkmesh-*`)
- [ ] `/usr/local/sbin/darkmesh-*.sh`
- [ ] `/srv/darkmesh/hb/docker-compose.yml`

## C) What NOT to back up online (offline escrow only)

- [ ] `/srv/darkmesh/hb/keys/`
- [ ] `/srv/darkmesh/arweave-data/wallets/`
- [ ] `/root/.cloudflared/*.json` and `cert.pem`

Keep these only in encrypted offline copies.

## D) Frequency / retention

- [ ] Daily incremental backup
- [ ] Weekly full snapshot
- [ ] Retention policy (example: 7 daily + 4 weekly + 3 monthly)

## E) Verification

- [ ] Enable backup integrity checks (hash/manifest verify)
- [ ] Weekly restore test to a separate test path/host
- [ ] Quarterly full disaster recovery drill

## F) Provider-specific guardrails

- [ ] Do not change NIC MAC address (provider lockout warning)
- [ ] Keep at least one tested offline copy of key material
- [ ] Document break-glass path for Tailscale/Cloudflare outage
