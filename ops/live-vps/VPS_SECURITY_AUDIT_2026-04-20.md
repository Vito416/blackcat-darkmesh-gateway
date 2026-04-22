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

0) HyperBEAM control-plane parity is partially restored (primary hostname transport fixed)
- Previous issue:
  - scheduler writes via public path returned edge `502`.
- Fix applied on 2026-04-21:
  - cloudflared ingress split:
    - `hyperbeam.darkmesh.fun -> 127.0.0.1:8734` (direct HB)
    - catch-all -> `127.0.0.1:8744` (nginx front path)
- Current observed behavior:
  - `https://hyperbeam.darkmesh.fun/~meta@1.0/info` = `200`
  - signed ANS104 `POST /~scheduler@1.0/schedule` via `hyperbeam.darkmesh.fun` returns HB-native `500 process_not_available` for missing PID (transport path OK; no edge `502`)
  - scheduler POST via catch-all demo domains may still return `502` due nginx upstream-header boundary on this path.
- Impact:
  - primary HB hostname is now valid transport path for control-plane sends,
  - full parity still requires target process availability on that scheduler.
- Operational rule now:
  - use `https://hyperbeam.darkmesh.fun` for control-plane writes,
  - keep `push`/`push1` as fallback until parity gate passes end-to-end.
- Permanent safeguard:
  - run mandatory parity gate before claiming production parity:
    - `ops/live-vps/local-tools/hb-full-parity-gate.sh`
    - spec: `ops/live-vps/HB_FULL_PARITY_GATE.md`

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

## Temporary Cloudflared Catch-All Note (demo phase)

- For domain onboarding demos, it is acceptable to temporarily set Cloudflared ingress fallback to:
  - `service: http://127.0.0.1:8744`
- This changes routing behavior (unknown hostnames no longer auto-fall back to tunnel `http_status:404`), but does **not** expose SSH or bypass Tailscale/UFW controls.
- Security implication:
  - increases public L7 traffic surface to the HB front path,
  - does not grant admin access by itself.
- Required guardrails while using catch-all:
  1. keep admin/signer endpoints out of public ingress,
  2. keep strict host-to-site validation in AO/HB path,
  3. keep rate limits/body limits on write-facing routes,
  4. monitor for unknown-host spikes and revert to strict host ingress if needed.
- Future-proof target state:
  - transport remains in Cloudflared,
  - paid/free and allow/deny policy decisions move to AO-signed HB policy evaluator (`off -> observe -> soft -> enforce`),
  - Cloudflared should stay transport-only, not business-policy authority.

## Deep Audit Snapshot (2026-04-21)

### Scope

- Live VPS runtime audit over Tailscale:
  - service/timer health
  - public + loopback endpoint behavior
  - cloudflared/nginx ingress integrity
  - scheduler control-plane parity checks
  - hidden-surface scan for unexpected public device actions

### Findings (ordered by severity)

1) **Medium: public cron/copycat surfaces are reachable**
   - Observed:
     - `GET /~cron@1.0/info` returns `200`
     - `GET /~cron@1.0/every?...` returns `200`
     - `GET /~copycat@1.0/info` returns `200`
   - Risk:
     - potential remote task scheduling / operational abuse if policy is not explicitly restricting these paths.
   - Required action:
     - implement route-policy gate to deny unauthenticated cron/copycat mutation routes;
     - keep read-only introspection if needed for ops, but block write-like verbs/paths by default.

2) **Low: healthcheck false-negative previously caused by root path behavior**
   - Observed:
     - healthcheck failed when `https://hyperbeam.darkmesh.fun/` returned `404`.
   - Fix applied:
     - ingress for `hyperbeam.darkmesh.fun` now points to local nginx loopback (`127.0.0.1:8744`), which provides root `302` to `~meta`.
   - Result:
     - `darkmesh-healthcheck.service` now passes.

3) **Low: cloudflared tunnel reconnection/icmp warnings**
   - Observed recurrent warnings:
     - datagram handler context-canceled / tunnel reconnection,
     - ICMP proxy disabled warning.
   - Impact:
     - expected for tunnel reconnect churn; no admin-plane exposure found.

### Verified healthy controls

- SSH hardening effective:
  - `PermitRootLogin no`
  - `PasswordAuthentication no`
- UFW default deny inbound; only tailscale SSH + tailscale wireguard ingress allowed.
- Public direct access to raw service ports (`8734`, `1984`, `22` over public IPv4) times out.
- Scheduler control-plane parity verified via signed ANS104 send (`status=200`, `slot` + `process` headers present).
- Domain smoke checks passed for:
  - `jdwt.fun`
  - `vddl.fun`
  - `blgateway.fun`
  - `hyperbeam.darkmesh.fun`

### Notes

- `adminops` currently has `NOPASSWD: ALL`; keep this as an explicit operational decision and track separately as hardening debt if least-privilege is required later.
