# HyperBEAM + Non-Miner Arweave Bootstrap Checklist

Purpose: first dedicated VPS bootstrap for project-owned HB runtime, while keeping the same untrusted-operator security posture.

## 1) Scope and constraints

- Runtime target:
  - Stock HyperBEAM node (no core source-code modifications).
  - Arweave node in non-mining mode.
  - AO process stack for project control plane.
- Security target:
  - HB/gateway remains untrusted for site/admin secrets.
  - Site worker signatures remain mandatory for write intent.

## 2) Pre-flight (before ordering/provisioning)

- [ ] Capture hardware baseline for this phase:
  - [ ] CPU >= 2 dedicated cores (current target profile is much higher).
  - [ ] RAM >= 4 GB minimum (current target profile is much higher).
  - [ ] NVMe/SSD sized for HB + Arweave non-miner growth.
- [ ] Confirm region and latency expectations (EU baseline chosen).
- [ ] Confirm stake path and wallet custody plan for HB operator identity.

## 3) Host bootstrap

- [ ] Install Linux host (Debian recommended for repeatable automation).
- [ ] Apply hardening baseline:
  - [ ] SSH restricted and key-only.
  - [ ] Firewall deny-by-default, explicit allowlist for required ports only.
  - [ ] Fail2ban/monitoring and audit logging enabled.
  - [ ] Tailscale admin path enabled for private ops access.
- [ ] Install Docker + compose tooling.

## 4) Wallet and key handling

- [ ] Create/import dedicated operator wallet used by HB node runtime.
- [ ] Enforce strict key permissions on server.
- [ ] Backup/recovery path stored offline and tested.
- [ ] Document key rotation steps (do not block node recovery).

## 5) Arweave node (non-mining) lane

- [ ] Deploy Arweave node in non-mining mode.
- [ ] Validate sync/health and storage growth behavior.
- [ ] Record service unit/container config and persistent volume mapping.
- [ ] Capture health probe commands in ops notes.

## 6) HyperBEAM lane

- [ ] Deploy stock HyperBEAM image.
- [ ] Configure runtime with project policy constraints:
  - [ ] Restrict/allow process scope as required for project operation.
  - [ ] Keep operator policy fail-closed for unknown process scope.
- [ ] Validate:
  - [ ] Node health endpoint.
  - [ ] AO process read path.
  - [ ] Process whitelist behavior.

## 7) Project control plane validation

- [ ] Validate AO registry route resolution (`host -> site -> runtime pointers`).
- [ ] Validate `-write` process per-site PID flow.
- [ ] Validate worker signing flow (write intents only).
- [ ] Validate replay/idempotency behavior on write paths.

## 8) Untrusted boundary verification (mandatory)

- [ ] Confirm no admin/site secrets are required on HB runtime.
- [ ] Confirm writes fail without valid site-worker signature.
- [ ] Confirm AO runtime pointers are consumed as hints; local cache is non-authoritative.
- [ ] Confirm gateway/HB restart does not alter authority decisions.

## 9) Cutover readiness

- [ ] Run smoke + deep checks from `ops/live-vps/local-tools/`.
- [ ] Run benchmark scenarios and capture raw JSON report.
- [ ] Archive run logs and exact runtime config snapshot.
- [ ] Freeze release note with:
  - [ ] runtime versions,
  - [ ] process IDs/module IDs,
  - [ ] known limits and rollback instructions.

## 10) Follow-up (future-proof)

- [ ] Add operator onboarding guide for third-party HB runners.
- [ ] Define reward/pool policy for trusted project-serving node set.
- [ ] Define admission criteria (SLA, region, abuse controls, policy conformance).
- [ ] Keep ability to route a small percentage to external nodes for interoperability testing.
