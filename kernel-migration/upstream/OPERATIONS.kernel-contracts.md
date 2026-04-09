# Operations Guide (v1)

This file documents **operator flows** for deploying and operating the Trust Kernel contracts.

Important:
- Security status: **not independently audited yet** (see: [SECURITY_STATUS](SECURITY_STATUS.md)).
- For production, use multisig authorities (Safe) and treat private keys as extremely sensitive.
- Do not share private keys/seed phrases in issues or logs.

## Deploy

Build notes:
- `InstanceController` is near the EIP-170 runtime limit, so this repo compiles “size-first”.
- See: [BUILD_AND_VERIFICATION](BUILD_AND_VERIFICATION.md)

Recommended baseline deployment:
- `ReleaseRegistry` (global, owned by Safe)
- `InstanceFactory` (points to ReleaseRegistry)
- `ManifestStore` (optional, for “full detail” mode availability)

Foundry scripts (see `blackcat-kernel-contracts/script/`):
- Deploy registry+factory: `DeployAll.s.sol`
- Deploy registry: `DeployReleaseRegistry.s.sol`
- Deploy factory: `DeployInstanceFactory.s.sol`
- Deploy ManifestStore: `DeployManifestStore.s.sol`

## Publish releases

Use `PublishRelease.s.sol` to publish official releases into `ReleaseRegistry`.
Relayer option (EIP-712):
- `PublishReleaseAuthorized.s.sol` calls `publishAuthorized(...)` with an owner signature.
- Batch relayer primitive: `publishBatchAuthorized(PublishBatchItem[] items, ...)`.
  - Foundry helper: `PublishReleaseBatchAuthorized.s.sol` reads ABI-encoded `PublishBatchItem[]` from `BLACKCAT_RELEASE_PUBLISH_BATCH_ITEMS_PATH`.

Inputs you must compute off-chain:
- `componentId` (`bytes32`) — stable component identifier
- `version` (`uint64`) — stable version encoding
- `root` (`bytes32`) — attested integrity root
- `uriHash` (`bytes32`) — `sha256(uri_string_bytes)`
- `metaHash` (`bytes32`) — optional metadata hash

Revocation:
- Use `RevokeRelease.s.sol` to revoke a `(componentId, version)`.
- Relayer option: `RevokeReleaseAuthorized.s.sol` calls `revokeAuthorized(...)` with an owner signature.
- Revoke by root (relayer): `RevokeByRootAuthorized.s.sol` calls `revokeByRootAuthorized(...)`.
- Batch relayer primitive: `revokeBatchAuthorized(RevokeBatchItem[] items, ...)`.
  - Foundry helper: `RevokeReleaseBatchAuthorized.s.sol` reads ABI-encoded `RevokeBatchItem[]` from `BLACKCAT_RELEASE_REVOKE_BATCH_ITEMS_PATH`.

## Create instance (per install)

Non-deterministic (simple; dev/dry-run):
- `CreateInstance.s.sol` uses `InstanceFactory.createInstance(...)`.

Use `CreateInstanceDeterministic.s.sol` with a stable `salt` so the instance address is predictable via `predictInstanceAddress`.

This script uses the **authorized** factory path (`createInstanceDeterministicAuthorized(...)`) and requires a root-signed setup
signature (`BLACKCAT_SETUP_SIGNATURE`). This prevents third parties from pre-claiming a CREATE2 salt.

Set the created controller address into your runtime config (`blackcat-config`) and treat it as a critical trust anchor.

## Upgrade flow

Propose:
- Raw root/uri: `ProposeUpgrade.s.sol`
- By ReleaseRegistry version: `ProposeUpgradeByRelease.s.sol`

Activate/cancel (safe helpers):
- `ActivateUpgradeExpected.s.sol`
- `CancelUpgradeExpected.s.sol`

Rolling upgrades:
- Set overlap window: `SetCompatibilityWindow.s.sol`
- Lock overlap window (irreversible): `LockCompatibilityWindow.s.sol`
- During the overlap, runtimes can accept either active state or compatibility state (`isAcceptedState`).
- Clear compatibility state: `ClearCompatibilityState.s.sol`
- Break-glass rollback (within overlap): `RollbackToCompatibilityState.s.sol`
  - Relayer option: `rollbackToCompatibilityStateAuthorized(...)` (see SPEC)
  - Script: `RollbackToCompatibilityStateAuthorized.s.sol`

## Monitoring and incidents

Reporter check-in (direct):
- `CheckIn.s.sol`

Permissionless bot guardrails (optional):
- `PauseIfStale.s.sol` calls `pauseIfStale()` (requires `maxCheckInAgeSec != 0`)
- `PauseIfActiveRootUntrusted.s.sol` calls `pauseIfActiveRootUntrusted()` (requires `releaseRegistry != 0`)

Incident reporting (direct; pauses the controller):
- `ReportIncident.s.sol`

Pause/unpause:
- Direct: `Pause.s.sol`, `Unpause.s.sol`
- Relayer signature: `setPausedAuthorized(...)` (see SPEC)

Relayer variants:
- `checkInAuthorized(...)`, `reportIncidentAuthorized(...)`, `setPausedAuthorized(...)`
  are intended for CLI/tooling that collects signatures on isolated devices and submits via a relayer.

Optional audit commitments:
- For batched Merkle root commitments of off-chain audit logs, see: [AUDIT_COMMITMENTS](AUDIT_COMMITMENTS.md)

## ReleaseRegistry pointer (controller)

If you deploy a new `ReleaseRegistry` (or want to remove enforcement), update the controller pointer:
- Set/clear: `SetReleaseRegistry.s.sol`
- Lock (irreversible): `LockReleaseRegistry.s.sol`

Notes:
- In strict mode, switching registries is validated: the new registry must trust the current active root (and any pending/compat roots).
- Clearing the registry pointer disables registry enforcement (dev only; not recommended for production).
- Once locked, the registry pointer cannot be changed (recommended for production after verification).

## Component pinning (optional)

If you publish multiple components into a single `ReleaseRegistry`, you can optionally pin the controller to a specific
`componentId` to prevent accidentally proposing upgrades using roots from a different component line.

- Set/clear: `SetExpectedComponentId.s.sol`
- Lock (irreversible): `LockExpectedComponentId.s.sol`

## Authority rotation (controller)

All authorities use a 2-step transfer to reduce operator mistakes:
1. Start transfer (root authority)
2. Accept transfer (new authority)

Scripts:
- Root authority: `StartRootAuthorityTransfer.s.sol`, `AcceptRootAuthority.s.sol`, `CancelRootAuthorityTransfer.s.sol`
- Upgrade authority: `StartUpgradeAuthorityTransfer.s.sol`, `AcceptUpgradeAuthority.s.sol`, `CancelUpgradeAuthorityTransfer.s.sol`
- Emergency authority: `StartEmergencyAuthorityTransfer.s.sol`, `AcceptEmergencyAuthority.s.sol`, `CancelEmergencyAuthorityTransfer.s.sol`
- Reporter authority: `StartReporterAuthorityTransfer.s.sol`, `AcceptReporterAuthority.s.sol`, `CancelReporterAuthorityTransfer.s.sol`

Relayer option (advanced):
- New authorities can also accept via EIP-712 signatures submitted by a relayer:
  - `acceptRootAuthorityAuthorized(...)`, `acceptUpgradeAuthorityAuthorized(...)`, `acceptEmergencyAuthorityAuthorized(...)`, `acceptReporterAuthorityAuthorized(...)`
- This is useful when the new authority is a Safe / `KernelAuthority` and you want multi-device approval without requiring the new authority to submit the on-chain tx itself.

## Attestations (pinning)

The controller provides `attestations[key]=value` slots (root authority) to pin additional integrity facts on-chain.

Example (recommended):
- `key = sha256("blackcat.runtime_config.canonical_sha256.v1")` (bytes32)
- `value = sha256(canonical_json(runtime_config))` (bytes32)

Less-strict hosting waiver (optional):
- `key = sha256("blackcat.hosting.cgi_fix_pathinfo.probe.canonical_sha256.v1")` (bytes32)
- `value = sha256(canonical_json({schema_version:1,type:"blackcat.hosting.cgi_fix_pathinfo.probe",result:"no_exec"}))` (bytes32)
- Set + lock this key only after you have run a PathInfo probe and decided the hosting is safe; `blackcat-core` may require it in `less-strict` mode.

Use `SetAttestation.s.sol` for a basic EOA flow (production should use Safe).
Write-once option (recommended for long-term trust anchors):
- Set + lock in one tx: `SetAttestationAndLock.s.sol`
- Lock an existing key: `LockAttestationKey.s.sol`
Clear an attestation:
- `ClearAttestation.s.sol`

Other recommended settings:
- Set upgrade timelock: `SetMinUpgradeDelay.s.sol`
- Lock upgrade timelock (irreversible): `LockMinUpgradeDelay.s.sol`
- Toggle auto-pause on bad check-in: `SetAutoPauseOnBadCheckIn.s.sol`
- Lock auto-pause (irreversible): `LockAutoPauseOnBadCheckIn.s.sol`
- Set max check-in age: `SetMaxCheckInAgeSec.s.sol` (recommended prod: `60`–`300`)
- Lock max check-in age (irreversible): `LockMaxCheckInAgeSec.s.sol`
- Emergency unpause policy: `SetEmergencyCanUnpause.s.sol` (recommended prod default: `0`)
- Lock emergency unpause policy (irreversible): `LockEmergencyCanUnpause.s.sol`
- Clear reporter authority: `ClearReporterAuthority.s.sol`

## Production finalization (one-shot)

If you want to set and lock the key “production knobs” in one transaction, use:
- `FinalizeProduction.s.sol`

This will set (if not already set) and then lock:
- `releaseRegistry`
- `expectedComponentId`
- `minUpgradeDelaySec`
- `maxCheckInAgeSec`
- `autoPauseOnBadCheckIn`
- `compatibilityWindowSec`
- `emergencyCanUnpause`

Notes:
- `maxCheckInAgeSec` must be non-zero for `FinalizeProduction` (the function locks it as part of the flow).
- If a knob is already locked, `FinalizeProduction` requires the passed value to match, otherwise it reverts (to prevent silently-finalizing with unexpected config).

## ManifestStore (optional “full detail” availability)

Upload a blob (expensive):
- `UploadManifestBlob.s.sol` reads a file, uses `sha256(fileBytes)` as `blobHash`, stores chunks, and finalizes.
- Use `BLACKCAT_CHUNKS_PER_TX` to batch multiple chunks per tx via `appendChunks(...)` (lower tx count, higher per-tx gas).

Consumers must:
- reassemble the blob and validate its `sha256` off-chain
- treat on-chain availability as an availability layer, not as “automatic trust”

## Dry run (Edgen)

Step-by-step dry run against Edgen Chain:
- [DRY_RUN_EDGEN](DRY_RUN_EDGEN.md)
- [DRY_RUN_EDGEN_KERNELAUTHORITY](DRY_RUN_EDGEN_KERNELAUTHORITY.md)
