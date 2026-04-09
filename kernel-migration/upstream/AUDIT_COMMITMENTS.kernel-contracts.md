# Audit Commitments (Optional)

This repository focuses on **on-chain trust state** (`InstanceController`) and **release trust** (`ReleaseRegistry`).

For some installations, it is also useful to maintain a *separate, append-only audit trail* of sensitive operations
performed off-chain (DB writes, policy changes, key rotations, etc.). Recording every operation on-chain is expensive,
so BlackCat favors a **batch commitment** approach:

1. The runtime appends operations to a local audit log (or outbox).
2. Periodically, it computes a Merkle root over a contiguous range of events.
3. It commits the root on-chain (cheap, verifiable, tamper-evident).

## Contract: `AuditCommitmentHub`

`src/AuditCommitmentHub.sol` is an **optional** event hub that supports:
- Monotonic per-install sequencing via `lastSeq[instance]`.
- Direct commits from `InstanceController.reporterAuthority()`.
- Relayed commits via EIP-712 signatures, with EIP-1271 support (Safe/KernelAuthority can sign).

It does **not** enforce server behavior. It provides:
- an immutable on-chain history (events),
- a verifiable “audit root timeline” you can compare with off-chain logs.

## Security model

- The hub derives the allowed signer from the installation’s `InstanceController`:
  - it reads `reporterAuthority()` via `eth_call` from the `instance` address.
- If the reporter authority changes on the controller, previously collected signatures will stop validating.
- `seqFrom` must always be `lastSeq[instance] + 1` to prevent replays and reordering.

## When to use

Recommended when you want one (or more) of:
- a chain-backed, queryable audit history for high-value installs,
- a mechanism to detect “audit gap” (missing commits),
- strong evidence during incident response.

Not required for the baseline trust model:
- production systems should already fail-closed on trust uncertainty via the runtime PEP/back-controller.

