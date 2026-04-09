# Audit Checklist (v1)

This is a practical checklist for reviewing the Trust Kernel contracts **before production**.

Scope:
- `ReleaseRegistry`
- `InstanceFactory`
- `InstanceController`
- `ManifestStore`
- `KernelAuthority` (optional authority mode)

Non-goals:
- Off-chain runtime policy and filesystem hardening (handled by `blackcat-core` + `blackcat-config`).
- RPC quorum logic (off-chain).

Related:
- Diagrams: [SECURITY_FLOWS](SECURITY_FLOWS.md)
- Spec: [SPEC](SPEC.md)

## Global checks (apply to all contracts)

- Compiler version pinned (`0.8.24`) and optimizer enabled.
- Static analysis run (Slither) and findings triaged before production:
  - `slither . --exclude-dependencies --filter-paths "test|script|out|broadcast|cache|deployments"`
- No unbounded loops reachable by untrusted callers.
- All ECDSA recoveries enforce low-`s` to prevent malleability.
- EIP-712 domain separators include `(name, version, chainId, verifyingContract)`.
- All relayer-authorized paths include:
  - a nonce,
  - a deadline,
  - and produce an audit event (`SignatureConsumed` / `AuthoritySignatureConsumed` / `SetupSignatureConsumed`).

## ReleaseRegistry

Files:
- `blackcat-kernel-contracts/src/ReleaseRegistry.sol`

### Access control
- Publishing/revocation restricted to `owner` (direct) or `owner` signature (authorized paths).
- Ownership transfer uses 2-step flow (`transferOwnership` → `acceptOwnership`) and the authorized equivalents.

### Correctness / invariants
- `(componentId, version)` is immutable:
  - cannot be re-published once set.
- Roots are unique:
  - the same `root` cannot appear under multiple releases (prevents ambiguity).
- Revocation is permanent:
  - `revokedRoots[root]` is sticky and cannot be cleared.
  - publishing a revoked root is rejected.
- `getByRoot(root)` reverse index matches the stored release data.

### Signature / replay protection
- `publishNonce` increments on every successful publish (direct or authorized).
- `revokeNonce` increments on every successful revoke (direct or authorized).
- Ownership signature nonces are monotonic (`ownershipTransferNonce`).
- Batch signatures cover `itemsHash = keccak256(abi.encode(items))` with struct arrays:
  - `PublishBatchItem[]`
  - `RevokeBatchItem[]`

### Failure modes to test
- Wrong signature / wrong signer / expired deadline → revert.
- Batch contains an invalid item (zero fields, duplicate root, already published, revoked root) → revert (and batch is atomic).

## InstanceFactory

Files:
- `blackcat-kernel-contracts/src/InstanceFactory.sol`

### Access control / invariants
- Deterministic creation uses only the authorized path:
  - `createInstanceDeterministicAuthorized(...)` must validate a rootAuthority signature.
- Signature must bind `salt` and `deadline`:
  - prevents signature replay into other CREATE2 addresses.
- CREATE2 salt reuse is impossible:
  - `create2` returns address(0) when already used.

### Initialization correctness
- Newly created clone must:
  - initialize exactly once,
  - set the expected authorities,
  - set `activeRoot/UriHash/PolicyHash` to genesis values,
  - set `factory = msg.sender`,
  - emit `Initialized` + `UpgradeActivated` (genesis).

### Registry propagation
- Factory passes the global `releaseRegistry` pointer into each controller.
- If `releaseRegistry != 0`, controller must reject untrusted genesis roots.

## InstanceController

Files:
- `blackcat-kernel-contracts/src/InstanceController.sol`

### Access control matrix

| Action | Who can do it | Relayer option |
|---|---|---|
| propose upgrade | `upgradeAuthority` | no (direct only) |
| activate/cancel upgrade | `rootAuthority` | yes (EIP-712) |
| pause/unpause | `rootAuthority` or `emergencyAuthority` (policy gated) | yes (EIP-712) |
| incident report | root/emergency/reporter | yes (EIP-712) |
| reporter check-in | `reporterAuthority` | yes (EIP-712) |
| rotate authorities | root | yes (pending authority signature accept) |
| attestations + locks | root | no (direct only) |

### Upgrade safety
- Proposal includes TTL and is rejected after expiry.
- Optional timelock (`minUpgradeDelaySec`) must be enforced on activation.
- `pendingUpgradeNonce` must prevent replay of old activation/cancellation signatures, especially across “re-propose in same timestamp”.
- Optional compatibility overlap:
  - `compatibilityState` is set only when enabled,
  - accepted state check allows either active or compat until `until`,
  - rollback only possible when compat exists.

### Pause / incident semantics
- `reportIncident*` pauses the controller.
- Reporting incident while already paused increments `pauseNonce` to invalidate previously prepared unpause signatures.
- `setPausedAuthorized` must enforce expected state (`expectedPaused`) to prevent TOCTOU.
- Emergency unpause must obey `emergencyCanUnpause` and lock.

### ReleaseRegistry enforcement
- If `releaseRegistry != 0`, controller must reject:
  - untrusted genesis root,
  - untrusted proposed roots,
  - untrusted compat roots,
  - untrusted rollback targets.
- If `expectedComponentId` is set, controller must reject upgrades from a different component line.

## ManifestStore (optional)

Files:
- `blackcat-kernel-contracts/src/ManifestStore.sol`

### Safety / availability
- Append-only chunk semantics; finalized blobs cannot be appended to.
- Batch upload (`appendChunks`) should enforce:
  - non-empty chunks,
  - bounded chunk size,
  - consistent `chunkCount/totalBytes`.
- Finalization must enforce expected counts and bytes.
- Ownership rotation is 2-step, plus relayer-authorized equivalents.

### Off-chain requirements (must be documented)
- Consumers MUST reconstruct blobs and validate `sha256(blobBytes) == blobHash`.
- On-chain availability must not be treated as automatic trust.

## KernelAuthority (optional)

Files:
- `blackcat-kernel-contracts/src/KernelAuthority.sol`

### Signature rules
- `signers[]` must be strictly sorted by address; signatures must be provided sorted as well.
- `threshold` must be in `[1..signers.length]`.
- All signatures enforce low-`s`.
- `nonce` increments exactly once per successful execute/batch.

### EIP-1271
- `isValidSignature(hash, signatureBlob)` must:
  - validate sorted signatures,
  - check threshold,
  - return magic value only on success.

## Off-chain integration assumptions (must be enforced by blackcat-core/config)

- Multi-RPC quorum (`2/3` recommended) for reads + sane timeouts.
- Fail-closed in production:
  - if on-chain state cannot be verified, deny security-critical writes and upgrades.
- Keep authority keys isolated (multi-device); avoid single-key authorities for prod.
