# Trust Kernel (Web3 / EVM) — v1 Spec

This is the working specification for the BlackCat **Trust Kernel**.

Related:
- Diagrams: [SECURITY_FLOWS](SECURITY_FLOWS.md)
- Threat model: [THREAT_MODEL](THREAT_MODEL.md)
- Policy enforcement: [POLICY_ENFORCEMENT](POLICY_ENFORCEMENT.md)
- Audit checklist: [AUDIT_CHECKLIST](AUDIT_CHECKLIST.md)

## Goal

BlackCat treats the local host filesystem as untrusted (FTP mistakes, compromised credentials, partial upgrades).
The system must be:
- **tamper-evident by default** (baseline),
- **tamper-resistant when hardened tiers are enabled** (HSM/KMS signing, out-of-band verification).

The Trust Kernel provides an **external trust authority** for installs/upgrades:
- on-chain state is the source of truth,
- the runtime fails closed in production when trust cannot be verified.

## Chain (v1 default)

Default chain is configurable, but v1 reference network is:
- Chain: Edgen Chain (EVM)
- `chain_id`: `4207`
- RPC: `https://rpc.layeredge.io`
- Explorer: `https://edgenscan.io`

Production must use multi-RPC quorum (recommended: `2/3`, minimum: `2/2`).

## Actors / authorities

Authorities are normally **external multisig wallets** (e.g. Safe) to avoid custom multisig logic in kernel contracts.

Optionally (advanced), BlackCat can use an on-chain EIP-712 threshold signer authority (`KernelAuthority`) to enforce multi-device signing without depending on Safe tooling.
See [AUTHORITY_MODES](AUTHORITY_MODES.md).

Recommended split:
- `root_authority` (highest): policy changes, authority rotation, thresholds.
- `upgrade_authority`: propose/stage/activate upgrades.
- `emergency_authority`: pause/unpause and break-glass controls.

Each authority can be a distinct Safe with different thresholds.

## Trust modes

Install-time selectable (with cost estimation):

1) `root_uri` (baseline / recommended)
   - Anchor a `bytes32 root` + `uriHash` (hash of a URI pointing to the full manifest).
   - Full file list stays off-chain (IPFS/HTTPS), still tamper-evident via the root.

2) `full` (paranoid)
   - Anchor more detail on-chain (chunked manifest bytes or per-file hashes).
   - Much more expensive; intended only for high-value deployments.

The contracts store hashes and emit events; full payloads are handled off-chain.

## Hashing (v1 canonical)

The contracts **do not** compute these values on-chain in v1. They are computed off-chain and stored as `bytes32`.

Canonical algorithms (single source of truth lives in `blackcat-integrity`):

- `root`: Merkle/tree root computed by `blackcat-integrity/src/TrustKernel/Sha256Merkle.php`
  - leaf: `sha256(0x00 || path || 0x00 || fileHashBytes32)`
  - node: `sha256(0x01 || left || right)` (duplicate last on odd count)
  - entries are sorted lexicographically by normalized path.
- `uriHash`: `sha256(uri_string_bytes)` (exact bytes; no implicit normalization).
- `policyHash`: `sha256(canonical_json(policy))` where canonical JSON is defined by `blackcat-integrity/src/TrustKernel/CanonicalJson.php` and policy schema by `blackcat-integrity/src/TrustKernel/TrustPolicyV1.php`.
- Baseline `root+uri` receipt helper: `blackcat-integrity/src/TrustKernel/RootUriReceiptV1.php`

## On-chain components

### `ReleaseRegistry` (global)

Purpose: publish “official” release roots for components.

Core mapping:
- `componentId (bytes32)` + `version (uint64)` → `{root, uriHash, metaHash}`

Notes:
- Version encoding must be stable. v1 uses `uint64` (implementation detail; may evolve).
- Publishing is gated (owner now; later: governance authority / Safe).
- Releases are immutable per `(componentId, version)` (republishing is rejected; publish a new version instead).
- Roots are unique across the registry (a `root` can be published only once) to avoid ambiguity.
- Ownership uses a 2-step transfer (`transferOwnership` → `acceptOwnership`) to reduce operator mistakes.
- Optional relayer variants use EIP-712 signatures:
  - `publishAuthorized(...)`, `revokeAuthorized(...)` (owner-signed)
  - `publishBatchAuthorized(...)`, `revokeBatchAuthorized(...)` (owner-signed batch ops)
    - batch ops sign `itemsHash = keccak256(abi.encode(items))` where `items` is an array of structs (`PublishBatchItem[]` / `RevokeBatchItem[]`)
  - `revokeByRootAuthorized(...)` (owner-signed convenience)
  - `transferOwnershipAuthorized(...)` (owner-signed), `acceptOwnershipAuthorized(...)` (pending-owner-signed)
  - Signers can be EOAs (ECDSA) or contracts implementing EIP-1271 (Safe / KernelAuthority).
- The registry supports **revocation** per `(componentId, version)`:
  - revocation permanently marks the release as revoked and its `root` as untrusted,
  - `isTrustedRoot(root)` becomes false after revocation,
  - publishing a release with a revoked root is rejected.
- Operators can publish/revoke in batches (`publishBatch`, `revokeBatch`) and revoke by root (`revokeByRoot`) for operational convenience.
- A reverse lookup is available (`getByRoot(root)`) for tooling/inspection.

### `ManifestStore` (optional, paranoid “full detail” mode)

Purpose: provide **on-chain availability** for large manifests/blobs without relying on off-chain hosting.

Core idea:
- store a blob as **append-only chunks** keyed by an off-chain `blobHash` (`bytes32`),
- consumers reconstruct the blob by reading chunks `0..chunkCount-1` via `eth_call`,
- consumers MUST verify the reconstructed bytes off-chain (e.g., `sha256(blobBytes) == blobHash`).

Notes:
- Writes are **owner-gated** to prevent third-party sabotage of official blobs.
- The contract intentionally does not attempt to recompute `blobHash` on-chain (keeps gas bounded and code smaller).
- Chunk uploads can be batched with `appendChunks(blobHash, chunks[])` to reduce tx count (bounded by per-tx gas).
- `uriHash` in the trust kernel can point to a ManifestStore blob via a stable URI string, e.g.:
  - `evm-manifest://chain=4207;store=0x...;blob=0x...`
  - and then `uriHash = sha256(uri_string_bytes)`.

### `InstanceController` (per install)

Purpose: per-install trust authority holding active attested state and upgrade history.

State:
- `activeRoot`, `activeUriHash`, `activePolicyHash`
- `paused`
- `pendingUpgrade` (proposal with TTL)
- Optional compatibility overlap (rolling upgrades):
  - `compatibilityWindowSec` (auto-sets a temporary compatibility state after activation)
  - `compatibilityState` (previous `{root, uriHash, policyHash}` accepted until `until`)
- Optional attestation slots (extensibility without contract changes):
  - `attestations[key] = value` (root authority)
  - `attestationUpdatedAt[key] = unix seconds`
  - `attestationLocked[key] = bool` (when true, that key becomes write-once)
- `rootAuthority`, `upgradeAuthority`, `emergencyAuthority`
- Optional `releaseRegistry` (if set, upgrades must reference trusted roots)
- Optional `releaseRegistryLocked` (if true, registry pointer is immutable)
- Optional `expectedComponentId` (if set, upgrades must belong to this component in the ReleaseRegistry)
- Optional `expectedComponentIdLocked` (if true, `expectedComponentId` is immutable)
- Optional `minUpgradeDelaySec` (timelock)
- Optional `minUpgradeDelayLocked` (if true, `minUpgradeDelaySec` is immutable)
- Optional `reporterAuthority` + `lastCheckInAt/lastCheckInOk` (monitoring agent check-in)
- Optional `autoPauseOnBadCheckIn` (auto-pause latch on a bad check-in)
- Optional `emergencyCanUnpause` (if false, emergency is pause-only; root can always unpause)
- Incident tracking: `incidentCount`, `lastIncidentAt`, `lastIncidentHash`, `lastIncidentBy`

Upgrade flow (v1):
1. `proposeUpgrade(root, uriHash, policyHash, ttlSec)` (upgrade authority)
   - Optional: `proposeUpgradeByRelease(componentId, version, policyHash, ttlSec)` fetches `{root, uriHash}` from `ReleaseRegistry.get(...)`.
   - `ttlSec` is bounded by `MAX_UPGRADE_TTL_SEC` (v1 default: `30 days`).
   - Increments `pendingUpgradeNonce` (anti-replay for signature-based actions).
2. Optional: `cancelUpgrade()` (root authority or upgrade authority)
   - Optional: `cancelUpgradeAuthorized(...)` allows a relayer to cancel using a `rootAuthority` EIP-712 signature (EOA or EIP-1271).
3. `activateUpgrade()` (root authority, within TTL and after timelock, if configured)
   - Optional: `activateUpgradeAuthorized(...)` allows a relayer to activate using a `rootAuthority` EIP-712 signature (EOA or EIP-1271).
   - Can be executed while `paused=true` (recommended for incident recovery: keep the runtime paused while applying a patch).
4. Optional safety helpers (same auth as above):
  - `cancelUpgradeExpected(...)` to avoid cancelling the wrong pending proposal.
  - `activateUpgradeExpected(...)` to avoid activating an unexpected pending proposal.

Compatibility overlap (optional):
- If `compatibilityWindowSec` is non-zero, `activateUpgrade*` stores the previous active `{root, uriHash, policyHash}` as `compatibilityState` for `compatibilityWindowSec`.
- During the overlap window, `isAcceptedState(...)` returns true for either the current active state or the compatibility state (rolling upgrades).
- If `releaseRegistry` is set, both active and compatibility roots must still be trusted in the registry to be accepted.
- Control plane:
  - `setCompatibilityWindowSec(sec)` (root authority; bounded by `30 days`)
  - `clearCompatibilityState()` (root authority)
  - `rollbackToCompatibilityState()` (root authority; break-glass rollback if still within overlap)
  - `rollbackToCompatibilityStateAuthorized(...)` (optional; relayer submits a `rootAuthority` EIP-712 signature; anti-replay via `rollbackNonce`)

Authorized upgrade actions (optional, for relayers):
- EIP-712 domain:
  - `name`: `BlackCatInstanceController`
  - `version`: `1`
  - `chainId`: `block.chainid`
  - `verifyingContract`: the controller address
- Signature encoding:
  - For EOA authorities: accepts 65-byte `(r,s,v)` or 64-byte EIP-2098 compact `(r,vs)` signatures.
  - Enforces the “low-s” rule (`s <= secp256k1n/2`) to prevent signature malleability.
  - For EIP-1271 authorities: forwards `signature` bytes to `isValidSignature(bytes32,bytes)`.
- Digests include the current `pendingUpgradeNonce` and `pendingUpgrade.createdAt`/`pendingUpgrade.ttlSec`, so signatures cannot be replayed across different proposals (even if two proposals happen in the same timestamp).
- Digest computation:
  - To keep the `InstanceController` deployable under EIP-170 (24,576B runtime), v1 intentionally does **not** expose on-chain `hash*` helper view functions.
  - Off-chain tooling computes digests using the canonical type strings below and `domainSeparator()`.
- Execution:
  - `activateUpgradeAuthorized(...)` / `cancelUpgradeAuthorized(...)` accept signatures from `rootAuthority` (EOA or EIP-1271 contract).
  - The controller emits `AuthoritySignatureConsumed(authority, digest, relayer)` for audit traces.

### InstanceController EIP-712 type strings (canonical)

These must match exactly (no spaces).

- `SetPaused`:
  - `SetPaused(bool expectedPaused,bool newPaused,uint256 nonce,uint256 deadline)`
- `AcceptAuthority`:
  - `AcceptAuthority(bytes32 role,address newAuthority,uint256 nonce,uint256 deadline)`
- `RollbackCompatibility`:
  - `RollbackCompatibility(bytes32 compatRoot,bytes32 compatUriHash,bytes32 compatPolicyHash,uint64 until,uint256 nonce,uint256 deadline)`
- `CheckIn`:
  - `CheckIn(bytes32 observedRoot,bytes32 observedUriHash,bytes32 observedPolicyHash,uint256 nonce,uint256 deadline)`
- `ReportIncident`:
  - `ReportIncident(bytes32 incidentHash,uint256 nonce,uint256 deadline)`
- `ActivateUpgrade`:
  - `ActivateUpgrade(bytes32 root,bytes32 uriHash,bytes32 policyHash,uint256 proposalNonce,uint64 createdAt,uint64 ttlSec,uint256 deadline)`
- `CancelUpgrade`:
  - `CancelUpgrade(bytes32 root,bytes32 uriHash,bytes32 policyHash,uint256 proposalNonce,uint64 createdAt,uint64 ttlSec,uint256 deadline)`

Role identifiers used by `AcceptAuthority` are `keccak256(...)` of:
- `root_authority`
- `upgrade_authority`
- `emergency_authority`
- `reporter_authority`

Authorized monitoring / incidents (optional, for relayers):
- `checkInAuthorized(...)`:
  - signature must be from `reporterAuthority` (EOA or EIP-1271),
  - digest includes `reporterNonce` (anti-replay); nonce is consumed by both `checkIn` and `checkInAuthorized`.
- `reportIncidentAuthorized(...)`:
  - signature may be from `rootAuthority`, `emergencyAuthority`, or `reporterAuthority` (if set),
  - digest includes `incidentNonce` (anti-replay); nonce is consumed by both `reportIncident` and `reportIncidentAuthorized`.
- `setPausedAuthorized(...)`:
  - signature may be from `rootAuthority` or `emergencyAuthority`,
  - digest includes `pauseNonce` (anti-replay); nonce is consumed by both `pause/unpause` and `setPausedAuthorized`.

Authorized authority acceptance (optional, for relayers):
- Standard 2-step rotation is: `start*Transfer(...)` (root) → `accept*Authority()` (new authority submits tx).
- For multi-device flows where the new authority should not submit the transaction directly, the controller also supports:
  - `acceptRootAuthorityAuthorized(...)`
  - `acceptUpgradeAuthorityAuthorized(...)`
  - `acceptEmergencyAuthorityAuthorized(...)`
  - `acceptReporterAuthorityAuthorized(...)`
- The signature must be from the **pending** authority address (EOA or EIP-1271).
- Each role has its own transfer nonce (anti-replay across repeated start attempts):
  - `rootAuthorityTransferNonce`
  - `upgradeAuthorityTransferNonce`
  - `emergencyAuthorityTransferNonce`
  - `reporterAuthorityTransferNonce`

If `releaseRegistry` is set:
- `initialize(...)` requires the genesis `root` to be trusted in the registry.
- `proposeUpgrade(...)` and `activateUpgrade()` require the proposed root to be trusted at the time of the call.

If `expectedComponentId` is set (and registry supports `getByRoot`):
- `proposeUpgrade(...)` / `activateUpgrade()` require the root to belong to the expected `componentId`.
- `proposeUpgradeByRelease(componentId, ...)` requires `componentId == expectedComponentId`.

Emergency flow:
- `pause()` (emergency authority or root authority)
- `unpause()` (root authority; emergency only if `emergencyCanUnpause=true`)
- Root authority can always pause/unpause as a fallback (recommended).
- `reportIncident(incidentHash)` can be called by root/emergency/reporter and will pause the controller and record incident metadata.
- Optional: `setPausedAuthorized(...)` allows a relayer to set pause/unpause using an EIP-712 signature from `rootAuthority` or `emergencyAuthority`.

Monitoring / check-ins (v1):
- `checkIn(observedRoot, observedUriHash, observedPolicyHash)` (reporter authority)
- Optional: `checkInAuthorized(...)` allows a relayer to submit a `reporterAuthority` EIP-712 signature (EOA or EIP-1271).
- The controller records `(lastCheckInAt, lastCheckInOk)` for off-chain health evaluation.
- If `autoPauseOnBadCheckIn` is enabled, a bad check-in pauses the controller and records an incident.
- Optional: staleness-based safety
  - `setMaxCheckInAgeSec(sec)` (root authority; `0` disables; bounded by `30 days`)
  - `lockMaxCheckInAgeSec()` (root authority; requires `maxCheckInAgeSec != 0`)
  - `pauseIfStale()` (permissionless) pauses + records an incident if the last check-in is older than `maxCheckInAgeSec`.

Incident reporting (v1):
- `reportIncident(incidentHash)` (root/emergency/reporter)
- Optional: `reportIncidentAuthorized(...)` allows a relayer to submit an EIP-712 signature from one of `{rootAuthority, emergencyAuthority, reporterAuthority}`.
- Optional: permissionless safety
  - `pauseIfActiveRootUntrusted()` (permissionless) pauses + records an incident if `activeRoot` is no longer trusted by `ReleaseRegistry` (when configured).

Production hardening (v1):
- `finalizeProduction(...)` is a one-shot helper for root authority that sets + locks multiple “knobs” (registry pointer, expected component id, upgrade delay, check-in staleness, auto-pause, compatibility window, emergency unpause policy).

Runtime optimization (v1):
- `snapshot()` aggregates the commonly-read state (paused + active hashes + pending proposal) into one `eth_call`.
- `snapshotV2()` returns operational/health metadata (check-in + incidents + key flags like registry lock / emergency unpause policy) in one call without changing the `snapshot()` ABI (backwards compatible).
  - `snapshotV2.flags` bitset:
    - `0x1` → `emergencyCanUnpause`
    - `0x2` → `releaseRegistryLocked`
    - `0x4` → `minUpgradeDelayLocked`
    - `0x8` → `emergencyCanUnpauseLocked`
    - `0x10` → `autoPauseOnBadCheckInLocked`
    - `0x20` → `compatibilityWindowLocked`
    - `0x40` → `expectedComponentIdLocked`
    - `0x80` → `maxCheckInAgeLocked`

### `InstanceFactory`

Purpose: create per-install `InstanceController` instances efficiently (EIP-1167 clones).

v1 factory is intentionally permissionless; the important part is that the server pins the correct controller address in runtime config.

Factory behavior (v1):
- `releaseRegistry` is configured at deployment time (immutable, can be `0x0`).
- `createInstance(...)` creates a clone (CREATE) and initializes it.
- `predictInstanceAddress(salt)` returns the deterministic CREATE2 address for the factory’s current implementation.
- `createInstanceDeterministicAuthorized(...)` creates a clone via CREATE2 (deterministic), as an optional “setup ceremony” path:
  - requires an EIP-712 signature from `rootAuthority` (EOA or EIP-1271 contract),
  - binds the signed request to `{chainId, factory address}` via domain separator,
  - uses CREATE2 so signatures cannot be replayed into multiple instances (salt reuse fails),
  - is intended for multi-device bootstrap when `rootAuthority` is Safe (EIP-1271) or `KernelAuthority` (EIP-1271).

## Runtime policy (off-chain)

The contracts store the attested state; **runtime enforcement** lives in `blackcat-core` + `blackcat-config`.

Key runtime config (see `blackcat-config`):
- `trust.web3.chain_id`
- `trust.web3.rpc_endpoints[]`
- `trust.web3.rpc_quorum`
- `trust.web3.max_stale_sec` (recommended prod default: `180`)
- `trust.web3.mode` (`root_uri` | `full`)
- `trust.web3.contracts.instance_controller`
- `trust.web3.contracts.release_registry` (optional)
- `trust.web3.tx_outbox_dir` (optional, for buffering tx during outages)

Enforcement tiers (off-chain semantics, committed via `activePolicyHash`):
- `strict`: fail-closed; requires multi-RPC quorum in production.
- `less-strict`: fail-closed; allows explicitly on-chain attested waivers for constrained hosting (e.g. `cgi.fix_pathinfo` probe).
- `warn`: non-production; logs loudly and relaxes some gates (e.g. single-RPC), but still denies unsafe sensitive ops.

Optional hardening (recommended for prod):
- pin security-critical commitments on-chain via `InstanceController.attestations` and have `blackcat-core` + `blackcat-config` fail closed on mismatch.
- attestation keys are `bytes32` computed as `sha256(label_bytes)` (hex encoded on-chain).
- common v1 labels:
  - `blackcat.runtime_config.canonical_sha256.v1` → `sha256(canonical_json(runtime_config))`
  - `blackcat.http.allowed_hosts.canonical_sha256.v1` → `sha256(canonical_json(http_allowed_hosts_payload))`
  - `blackcat.composer.lock.canonical_sha256.v1` → `sha256(canonical_json(composer.lock))`
  - `blackcat.php.fingerprint.canonical_sha256.v2` → `sha256(canonical_json(php_fingerprint_payload_v2))`
  - `blackcat.image.digest.sha256.v1` → `sha256:<64-hex>` (raw 32-byte sha256)
  - `blackcat.hosting.cgi_fix_pathinfo.probe.canonical_sha256.v1` → `sha256(canonical_json({schema_version:1,type:"blackcat.hosting.cgi_fix_pathinfo.probe",result:"no_exec"}))`
    - required when `cgi.fix_pathinfo=1` in `less-strict` mode

Outage rules (recommended for prod):
- if RPC quorum is lost: **pause writes immediately**, buffer critical actions to an outbox if available
- allow reads only until stale (`max_stale_sec`), then fail closed

## Minimal install (core-only on server)

Target server installs only:
- `blackcat-core` (plus dependencies)
- a file-based runtime config (no env dependence)

Setup is done on a separate device:
1. create/clone the per-install controller contract
2. verify the transaction and resulting contract address on-chain
3. confirm via multisig threshold (multiple devices)
4. copy the controller address + chain config into the server runtime config

## Open questions (tracked for Stage 0 → Stage 1)

- Stable version encoding for `ReleaseRegistry` (semver packing vs bytes32 versionId).
- EIP-712 “setup request” format for offline review (optional if Safe is used end-to-end).
- Whether `InstanceController` should reference `ReleaseRegistry` (version-based activation) instead of raw roots.
- Detailed `full` mode encoding strategy (chunking, gas ceilings, pruning).
