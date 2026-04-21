# VPS Security Audit - 2026-04-20

Host: `<VPS_HOSTNAME_OR_PUBLIC_IP>`

Scope:
- OS/network hardening verification
- SSH/UFW/fail2ban checks
- runtime checks for Arweave + HyperBEAM + cloudflared
- key handling and backup readiness

## Findings

### High

1) Tailscale SSH currently allows `root` login from tailnet
- Confirmed by successful `tailscale ssh root@...`.
- Risk: bypasses local SSH hardening intent (`PermitRootLogin no`) because access policy is controlled by Tailscale ACL/SSH policy.
- Action: lock to least privilege in Tailscale admin policy (allow only `adminops`, no root except emergency break-glass group/tag).

2) Arweave wallet key permissions were too open (fixed)
- Path: `/srv/darkmesh/arweave-data/wallets/arweave_keyfile_*.json`
- Previous state: file `0644`, directory `0755`
- Applied fix:
  - directory `0700`
  - wallet file `0600`
- Re-validated on 2026-04-21 after drift:
  - directory `0700`
  - wallet file `0600`

### Medium

3) No encrypted offsite backup configured yet
- Provider warning explicitly states irreversible data loss on drive failure.
- Local config snapshot backup is now active:
  - `/usr/local/sbin/darkmesh-backup-config.sh`
  - `/etc/systemd/system/darkmesh-config-backup.service`
  - `/etc/systemd/system/darkmesh-config-backup.timer` (daily, persistent)
- Latest on-host verification:
  - archive checksum validated (`sha256sum -c`),
  - archive contents validated (`tar -tf`).
- Offsite stack is staged:
  - `restic` installed,
  - `/etc/darkmesh/backup.env` created as root-only template (no credentials yet),
  - `darkmesh-backup.timer` kept disabled by policy until repository credentials are filled.
- Remaining action: add encrypted offsite target credentials + full offsite restore drill.

4) Services bind to `0.0.0.0` (defended by firewall)
- `1984/tcp` (Arweave) and `8734/tcp` (HB) listen on all interfaces.
- UFW default deny + only `22/tcp` on `tailscale0` allow keeps this acceptable.
- Action: optional defense-in-depth bind to loopback where possible if direct external access is never needed.

### Low

5) Observability and incident hooks missing
- No explicit alerting for service down, tunnel disconnect, disk pressure, or memory pressure.
- Action: add basic watchdog/alerts (e.g. health cron + notifications).
 - Update: basic runtime healthcheck timer added:
   - `/usr/local/sbin/darkmesh-healthcheck.sh`
   - `/etc/systemd/system/darkmesh-healthcheck.service`
   - `/etc/systemd/system/darkmesh-healthcheck.timer`
   - Timer is enabled and running every ~5 minutes.
 - Update: alert hook template + unit added and webhook payload bug fixed:
   - `/usr/local/sbin/darkmesh-health-alert.sh`
   - `/etc/systemd/system/darkmesh-healthcheck-alert@.service`

## Verified Baseline

- SSH hardening effective:
  - `PermitRootLogin no`
  - `PasswordAuthentication no`
  - `AllowUsers adminops`
  - `AllowTcpForwarding no`
- UFW:
  - default deny incoming
  - only `22/tcp` allowed on `tailscale0`
- `fail2ban`, `unattended-upgrades`, `docker`, `cloudflared-tunnel`, `arweave-node` active.
- Public tunnel endpoints responding:
  - `https://arweave.<your-domain>/info`
  - `https://hyperbeam.<your-domain>`
- Local config snapshot backup timer active:
  - `darkmesh-config-backup.timer`
- Local config backup integrity verification timer active:
  - `darkmesh-config-verify.timer` (weekly, verifies checksum + extract + required files)
- Local config retention prune timer active:
  - `darkmesh-config-prune.timer` (weekly, default retention 120 days)

## Provider Warning Handling

### "Regular backup required"
- Status: partially implemented.
- Completed:
  - daily local config snapshot + integrity check (`sha256`).
- Required before production:
  - encrypted offsite backup destination
  - periodic restore verification drill

### "MAC address changing is prohibited"
- Operational rule: never use `macchanger` or custom netplan/udev MAC spoofing on server NICs.
- Keep provider-assigned MAC untouched to avoid lockout.

## Pending Hardening Checklist

- [x] Remove `/etc/sudoers.d/90-adminops-nopasswd`
- [x] Add narrow readonly sudo profile for `adminops` (`/etc/sudoers.d/91-adminops-ops-readonly`)
- [ ] Restrict Tailscale SSH policy to disallow root logins by default
- [ ] Restrict Tailscale SSH policy to disallow root logins by default (snippet prepared in `TAILSCALE_SSH_POLICY_SNIPPET.md`)
- [ ] Add encrypted offsite target for config snapshots
- [x] Add local config archive integrity drill (automated timer + manual run verified)
- [ ] Add full offsite restore-drill runbook and execute first restore test
- [x] Add service health checks (cloudflared, arweave, hb)
- [ ] Add alert delivery channel (mail/webhook) for failed health checks
- [ ] Optional: evaluate loopback-only binding for local-origin services

## Backup Scope Decision

- Online backup is intentionally minimal and excludes keys.
- Rebuildable assets are now tracked in git runtime templates.
- Secret material is handled only via offline encrypted escrow.
- See:
  - `ops/live-vps/GIT_RESTORE_MATRIX.md`
  - `ops/live-vps/BACKUP_AND_RECOVERY_CHECKLIST.md`
