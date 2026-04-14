# AO + Gateway Integrity Design (Kernel-Derived)

This is the target design for replacing Solidity-era integrity controls with AO-native controls consumed by Gateway.

## 1) Trust layers

- **Layer A (AO integrity state)**: canonical trusted roots, release metadata, authority/key policy, incident state.
- **Layer B (Write integrity transitions)**: only signed, validated state transitions are emitted to AO.
- **Layer C (Gateway runtime enforcement)**: gateway serves/proxies only when artifact and policy checks pass.

## 2) Integrity objects

Gateway and AO should converge on these canonical objects:

- `ReleaseRecord`
  - `componentId`
  - `version`
  - `root`
  - `uriHash`
  - `metaHash`
  - `publishedAt`
  - `revokedAt` (optional)

- `IntegrityPolicy`
  - `activeRoot`
  - `activeUriHash`
  - `activePolicyHash`
  - `pendingUpgrade` (optional: root/hash/expiry/proposedAt)
  - `compatibilityState` (optional: root/hash/until)
  - `paused`
  - `maxCheckInAgeSec`
  - `autoPauseOnBadCheckIn`
  - `emergencyCanUnpause`

- `AuthoritySet`
  - `root`
  - `upgrade`
  - `emergency`
  - `reporter`
  - keyring refs (`signatureRef` + pubkey material ref)

- `AuditCommitment`
  - `seqFrom`
  - `seqTo`
  - `merkleRoot`
  - `metaHash`
  - `reporterRef`
  - `acceptedAt`

## 3) Gateway enforcement model

### 3.1 Fast path (every request)

- verify current route/template cache key against a pre-verified `activeRoot` map
- serve only if cache entry status is `verified=true` and not expired
- if policy says `paused=true`, block mutable operations and optionally serve degraded read-only mode

### 3.2 Slow path (triggered)

Triggered on startup, cache miss, version bump, policy change:
- fetch AO integrity snapshot
- fetch referenced Arweave manifest/artifact
- verify hash/root membership and policy hash linkage
- write local signed checkpoint file (for restart continuity)
- mark cache entries verified or reject

This keeps runtime CPU stable on minimum VPS tiers and avoids expensive per-request verification.

## 4) VPS constraints

Design assumptions:
- no mandatory background queue required for correctness
- local file writes may exist but must be optional and bounded
- no dependence on privileged process managers
- avoid memory-heavy persistent data structures

Practical approach:
- bounded in-memory maps + optional disk snapshot (`json`/`ndjson`)
- deterministic startup restore from AO + snapshot
- strict timeouts on remote fetch and signature checks

## 5) Failure policy

Required fail-safe behavior:
- AO unavailable:
  - continue read-only from last valid checkpoint for limited grace window
  - block mutating/proxy-sensitive operations
- integrity mismatch:
  - do not serve unverified artifact
  - emit `gateway_integrity_violation_total`
  - optionally trigger emergency pause command path
- stale check-in threshold exceeded:
  - enter degraded mode and alert

## 6) Key rotation and signature model

Requirements:
- no hard dependency on static wallet identity in code
- rotatable key references via AO/write keyring
- explicit signer metadata in audit logs

Implementation direction:
- ed25519 primary verification profile
- optional threshold semantics through multiple authorized signer refs
- nonces/deadlines enforced by AO/write action validators

## 7) Metrics and observability

Minimum metrics to add in gateway:
- `gateway_integrity_verify_ok_total`
- `gateway_integrity_verify_fail_total`
- `gateway_integrity_checkpoint_age_seconds`
- `gateway_integrity_policy_paused` (gauge)
- `gateway_integrity_unverified_block_total`
- `gateway_integrity_fallback_readonly_total`

These complement existing webhook/cache metrics.

## 8) Data flow sketch

1. Write publishes signed integrity transition.
2. AO updates canonical integrity state and emits audit entry.
3. Gateway detects state/version change.
4. Gateway verifies artifacts against AO trusted root.
5. Gateway serves only verified entries and enforces current policy.

## 9) Compatibility with current repos

- `blackcat-darkmesh-write`: keeps command validation/signature/idempotency.
- `blackcat-darkmesh-ao`: owns integrity source of truth and read APIs.
- `blackcat-darkmesh-gateway`: enforces runtime integrity decisions at the edge/backend layer.

This gives us kernel-level guarantees without EVM lock-in.

## 10) Versioned contract surface

The gateway-facing AO integrity snapshot contract is versioned separately in:
- `security/contracts/README.md`
- `security/contracts/integrity-snapshot-v1.schema.json`

This keeps the data contract explicit while the parser and migration notes evolve
independently.

## 11) Release closeout evidence

- `scripts/check-ao-gate-evidence.js --file ops/decommission/ao-dependency-gate.json` is the closeout guardrail for the AO dependency gate itself.
- It checks that required gate items exist, IDs stay unique, closed items point to real evidence, and timestamps/releases are sane before we call a release evidence bundle complete.
- In `--strict` mode it fails closed until every required AO dependency check is `closed`, which makes the release archive easier to audit later.
