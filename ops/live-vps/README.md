# Live VPS Runbook

Canonical docs for the current production-like VPS model.

## Status

- Canonical runtime is now VPS + Node + Cloudflare Tunnel.
- Public entrypoint should be `https://gateway.blgateway.fun` (or your mapped hostname), with local gateway bound to loopback (`127.0.0.1:8080`).

## Runtime model

- `blackcat-gateway.service` runs the Node gateway process.
- `cloudflared.service` publishes the local gateway over Cloudflare Tunnel.
- AO/-write interactions happen over HTTP APIs; worker remains signer/notification boundary.
- Trust model remains untrusted-operator aware:
  - Gateway operator is not trusted with admin secrets.
  - Site worker signatures and per-site policy controls are authoritative for write intents.

## Day-2 quick checks

```bash
systemctl status blackcat-gateway --no-pager
systemctl status cloudflared --no-pager
curl -fsS https://gateway.blgateway.fun/healthz
```

## Files in this folder

- `LIVE_STRICT_DRILL_COMMANDS.md` - strict pre-live drill commands.
- `HB_NON_MINER_BOOTSTRAP_CHECKLIST.md` - dedicated VPS bootstrap checklist for stock HB + non-mining Arweave path.
- `HB_TRAFFIC_MODEL_NO_LB_VS_CF_LB.md` - architecture model for default (no LB) and premium (CF LB) traffic steering.
- `CF_DNS_AND_LB_OPERATOR_CHECKLIST.md` - practical Cloudflare dashboard checklist (free-first DNS mode + paid LB mode).
- `HARDENING_COMMAND_LOG_2026-04-20.md` - exact command log from first hardening/bootstrap run (for recreate).
- `HB_ARWEAVE_BRINGUP_NEXT.md` - next-step commands for bringing HB + Arweave containers up after hardening.
- `VPS_SECURITY_AUDIT_2026-04-20.md` - current security audit with findings, fixed items, and pending hardening checklist.
- `BACKUP_AND_RECOVERY_CHECKLIST.md` - pre-production backup/restore checklist (including provider guardrails).
- `FREE_BACKUP_MODE.md` - free-only backup operation mode (no paid offsite provider).
- `BACKUP_PROVIDER_QUICKSTART.md` - provider-specific steps to activate encrypted restic backups.
- `TAILSCALE_SSH_POLICY_SNIPPET.md` - ready-to-paste policy example to restrict Tailscale SSH root access.
- `GIT_RESTORE_MATRIX.md` - exact split of rebuildable-from-git/network vs offline-only secrets.
- `runtime/README.md` - reproducible runtime templates for systemd/scripts/compose + `runtime/restore.sh` helper.
  - includes `darkmesh-config-backup.*`, `darkmesh-config-verify.*`, and `darkmesh-healthcheck-alert@.service` templates synced with live host.
- `local-tools/FIRST_PRODUCTION_LIKE_CHECKLIST.md` - operator checklist for first production-like run.
- `local-tools/pull-latest-config-backup.sh` - pull latest config backup over Tailscale and verify checksum locally.
- `local-tools/prodlike-smoke.sh` - quick smoke checks against a live gateway URL.
- `local-tools/prodlike-deep-check.sh` - deeper API/security contract checks.
- `local-tools/prodlike-full-suite.sh` - smoke + deep checks for one or two hostnames.

If you need to keep temporary operator credentials locally, do it outside git-tracked paths.
