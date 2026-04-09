# Migration Backlog (P0/P1/P2)

This backlog is written to avoid re-discovery work and to make execution straightforward.

## P0 - Mandatory before kernel repo retirement

### P0.1 AO integrity registry contract surface
- Define/implement AO actions for:
  - publish/revoke release
  - query trusted root / release by version / release by root
  - policy pause state query
- Add role/signature enforcement for registry-mutating actions.
- Add replay/idempotency tests for registry writes.

Acceptance:
- AO tests prove trusted/untrusted/revoked root transitions.
- Gateway can fetch a stable trusted-root snapshot from AO.

### P0.2 Gateway artifact verifier
- Add module to verify fetched template bundles against AO trusted roots.
- Cache verification status and block serving unverified artifacts.
- Add strict error classes:
  - `integrity_mismatch`
  - `missing_trusted_root`
  - `policy_paused`

Acceptance:
- unit tests for pass/fail/hash-mismatch/revoked-root paths.
- metrics increment on block.

### P0.3 Policy pause + degraded mode
- Add gateway runtime gate controlled by AO policy state.
- Implement read-only fallback behavior for mutable endpoints.
- Ensure deterministic response codes and audit logs.

Acceptance:
- integration test: when `paused=true`, mutating endpoints fail closed.

### P0.4 Migration parity tests
- Translate critical kernel scenarios:
  - pending upgrade activation/cancel
  - revoked root rejection
  - compatibility rollback acceptance
  - stale check-in defensive path (if modeled in gateway)

Acceptance:
- parity test matrix exists and passes in CI.

## P1 - Security hardening and operational maturity

### P1.1 Authority separation and rotation workflow
- Model `root/upgrade/emergency/reporter` authority set in AO state.
- Add rotatable signer references and migration-safe key update flow.
- Add explicit key-rotation runbook and tests.

### P1.2 Audit commitments stream
- Implement AO audit commitment entries (`seqFrom/seqTo/merkleRoot/metaHash`).
- Correlate gateway events with AO commitment sequences.

### P1.3 Signed local checkpoint (gateway)
- Persist last valid integrity snapshot with signature/hash.
- On restart, restore only if checkpoint verifies.

### P1.4 Incident/reporting hooks
- Add incident action path and metrics pipeline.
- Add operator runbook for pause/resume and incident ack.

## P2 - Performance and platform polish (WEDOS-first)

### P2.1 Verification scheduling optimizations
- Verify on startup/cache-fill/state-change only.
- Add bounded refresh strategy for hot artifacts.

### P2.2 Resource budgets and limits
- Cap verifier CPU/timeouts.
- Bound cache sizes and checkpoint history length.
- Add stress tests for constrained memory.

### P2.3 Optional diskless mode
- Ensure gateway works even without local checkpoint writes.
- Keep correctness through AO fetch + memory-only verification.

## P3 - Nice-to-have / ecosystem scale

- Multi-region verifier consistency checks.
- Cross-gateway attestation exchange.
- Additional formal validation of integrity state transitions.

## Suggested execution order

1. P0.1 + P0.2
2. P0.3 + P0.4
3. P1.1
4. P1.2 + P1.4
5. P1.3
6. P2

## Exit criteria (migration complete)

- All P0 items finished and tested.
- P1.1 implemented (authority rotation cannot be missing).
- Gateway blocks unverified/revoked artifacts in production mode.
- AO integrity APIs documented and versioned.
