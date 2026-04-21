# Free Backup Mode (No Paid Provider)

Goal: keep backups free while preserving solid recovery for this project stage.

## Model

- Keep VPS local backup automation:
  - `darkmesh-config-backup.timer` (daily config snapshot, no secrets)
  - `darkmesh-config-verify.timer` (weekly integrity drill)
  - `darkmesh-config-prune.timer` (weekly retention cleanup)
- Keep offsite provider backup (`restic`) disabled until/if paid provider is accepted.
- Offsite copy is done manually from your local machine (then upload to your preferred free storage accounts).

## Why this is still safe enough now

- Backups contain reproducible runtime config only (no private keys).
- Secrets remain offline-only by policy.
- Weekly integrity verification ensures archive + checksum + required files are usable.

## Local pull flow (manual offsite copy)

1) Pull latest config archive from VPS to local machine.
2) Verify checksum locally.
3) Upload resulting files to your free storage targets (for example two separate accounts).

Helper script:
- `ops/live-vps/local-tools/pull-latest-config-backup.sh`

Example (this workspace):

```bash
./ops/live-vps/local-tools/pull-latest-config-backup.sh adminops@<TAILNET_IPV4> \
  /mnt/c/Users/jaine/Desktop/BLACKCAT_MESH_NEXUS/tmp/proton-offsite-staging/account-a
```

Then copy same files to your second account staging folder (`account-b`) and upload both.

## Important limits

- This is not fully automatic offsite DR.
- If you skip manual uploads for long periods, offsite recovery freshness degrades.
- For production-grade DR, enable encrypted offsite provider backup later.
