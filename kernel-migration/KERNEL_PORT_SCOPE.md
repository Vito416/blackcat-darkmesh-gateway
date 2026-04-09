# Kernel Port Scope (Detailed)

This document maps upstream `blackcat-kernel-contracts` responsibilities to AO + Gateway responsibilities.

## 1) Upstream components and migration target

### `ReleaseRegistry.sol` -> AO release registry state

Keep:
- release identity: `componentId`, `version`, `root`, `uriHash`, `metaHash`
- trust queries: published/revoked/trusted root semantics
- ownership/authority-gated publish/revoke operations
- batch publish/revoke behavior

Adapt:
- EIP-712 typed hashes -> AO message signatures and keyring verification
- on-chain events -> AO audit stream + Arweave proof references

Drop:
- EVM-specific signature recovery internals
- gas-optimized storage patterns that only make sense on EVM

Primary destination:
- AO process contract in `blackcat-darkmesh-ao` (registry/integrity namespace)
- read endpoint consumed by gateway for trusted roots

### `InstanceController.sol` -> AO integrity state machine + gateway enforcement

Keep:
- authority separation (`root`, `upgrade`, `emergency`, `reporter`)
- staged upgrade lifecycle (`propose -> activate/cancel`)
- pause/unpause model and emergency controls
- compatibility rollback window concept
- check-in freshness and stale detection
- incident report channel
- attestation key-value with lock semantics

Adapt:
- per-instance contract state -> per-site/process AO state object
- Solidity errors/events -> AO response codes + structured audit records
- signed privileged actions -> AO keyring rules (`signatureRef`, rotatable pubkeys)

Drop:
- EVM ABI-facing methods that only serve contract call ergonomics

Primary destination:
- AO process: integrity sub-state and admin actions
- Gateway: read-only policy consumer, fail-closed gating, cache invalidation strategy

### `InstanceFactory.sol` -> deployment tooling and deterministic process metadata

Keep:
- deterministic instance identity concept
- setup ceremony constraints

Adapt:
- clone/create2 semantics -> deterministic AO deployment metadata and manifest anchors
- setup signatures -> deployment manifest signatures validated in deploy tooling

Drop:
- bytecode clone mechanics

Primary destination:
- AO deploy tooling (`blackcat-darkmesh-ao/scripts/deploy`)
- Gateway config bootstrap validators

### `KernelAuthority.sol` -> keyring and threshold policy

Keep:
- multi-key, threshold-style authority intent
- explicit nonce/deadline protections

Adapt:
- EIP-1271 flow -> AO-native signature verification profile (ed25519 first-class)
- execution batching -> AO admin batch actions with explicit audit trail

Drop:
- contract wallet-specific `isValidSignature` shape

Primary destination:
- AO keyring/permissions process + write-side key management conventions

### `ManifestStore.sol` -> Arweave + AO references, optional local verifier cache

Keep:
- chunked/blob integrity concept
- finalize semantics with expected length/chunk count

Adapt:
- on-chain blob storage -> Arweave object + manifest references
- ownership-protected append/finalize -> publish pipeline checks

Drop:
- contract-level chunk storage itself

Primary destination:
- write publish/export flow + AO immutable refs + gateway cache verifier

### `AuditCommitmentHub.sol` -> AO audit commitment stream

Keep:
- commitment batches (`seqFrom`, `seqTo`, `merkleRoot`, `metaHash`)
- reporter authorization model
- replay-safe signature consumption logic

Adapt:
- hub events -> AO audit process entries and optional Arweave commitment mirrors

Drop:
- EVM-centric signature helper internals

Primary destination:
- AO audit process + gateway observability correlation IDs

## 2) Scripts migration scope (from `script/*.s.sol`)

Keep as behavior references:
- deploy orchestration
- authority transfer/accept/cancel flows
- pause/rollback/check-in routines
- release publish/revoke routines

Target replacement:
- Node/Lua deployment and admin helpers in AO/Write repos (`scripts/deploy`, `scripts/cli`)

Not to carry forward:
- Foundry broadcast scripting and EVM chain RPC assumptions

## 3) Test migration scope

Upstream has broad coverage (stateful fuzz + authority + edge paths). We must preserve equivalent coverage as:
- Lua/Node integration tests across AO + write + gateway,
- deterministic policy tests for proposed/active/compatibility states,
- incident + stale-check + auto-pause behavior tests,
- signature/key-rotation and replay tests.

## 4) Non-portable parts (explicitly excluded)

These are intentionally not ported as-is:
- Solidity contract binaries and deployment bytecode assumptions
- gas constraints and opcode-level micro-optimizations
- EVM-specific typed data domain separation format requirements

## 5) Output of this migration

After migration, integrity ownership should be:
- AO: source of integrity policy and trusted release state
- Write: producer of signed/validated transitions
- Gateway: enforcement and caching layer using AO-authenticated integrity facts

This preserves the security model while removing EVM runtime dependency.
