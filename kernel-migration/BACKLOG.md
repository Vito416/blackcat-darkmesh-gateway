# Migration Backlog (P0/P1/P2)

This backlog is written to avoid re-discovery work and to make execution straightforward.

## Tracker

- Status legend: `[ ]` not started, `[~]` in progress, `[x]` done.

- Gateway-side implementation is largely complete for the current migration slice; the remaining blockers are mostly AO-side registry/authority lifecycle work and the final decommission evidence.

## This week execution

- [gateway] Keep the integrity gate aligned with the live AO snapshot shape and retain the new smoke/CI checks as the default path.
- [gateway] Finish the last parity coverage for upgrade activation/cancel, rollback acceptance, revoked root rejection, and stale-state defense.
- [ao] Close the registry actions for publish/revoke/query/pause state so gateway consumers can trust one stable API surface.
- [ao] Finalize `root/upgrade/emergency/reporter` lifecycle and audit commitment sequencing/query surfaces for the v1.4.0 workflow.
- [ops] Capture the remaining decommission artifacts: recovery drill timestamps, AO fallback drill, and rollback proof, then record the sign-off.

## Open blockers

### Gateway-side remaining work
- No known functional blocker remains on the gateway slice for v1.4.0.
- Keep the integrity gate and migration docs aligned with any late AO/API shape changes.

### AO-side dependencies
- Final AO registry actions for publish/revoke/query/pause state.
- AO authority lifecycle completion for `root/upgrade/emergency/reporter`.
- AO audit commitment sequencing/query surface and release-root parity in the snapshot API.

### Evidence-only tasks before decommission
- Recovery drill timestamps captured in the notes.
- AO outage fallback drill artifact captured and linked.
- Rollback proof captured for at least one failure scenario.
- Final stakeholder sign-off recorded against the checklist.

- [~] P0.1 AO integrity registry contract surface (AO PR in flight; registry authority/audit extensions underway)
- [~] P0.2 Gateway artifact verifier (core verifier + cache enforcement landed; AO release-root parity still pending)
- [~] P0.3 Policy pause + degraded mode (runtime gate landed; checkpoint restore/fallback coverage expanded)
- [x] P0.4 Migration parity tests
- [~] P1.1 Authority separation and rotation workflow (gateway role-aware signature-ref gate + runbook landed; AO-side final authority lifecycle remains)
- [~] P1.2 Audit commitments stream (gateway audit seq/lag metrics landed; AO-side commitment sequencing integration still pending)
- [x] P1.3 Signed local checkpoint (gateway)
- [~] P1.4 Incident/reporting hooks (incident/state endpoints + metrics + tests landed; operator automation/runbook hardening remains)
- [x] P2.1 Verification scheduling optimizations
- [x] P2.2 Resource budgets and limits
- [x] P2.3 Optional diskless mode

## P0 - Mandatory before kernel repo retirement

### P0.1 AO integrity registry contract surface
- Define/implement AO actions for:
  - publish/revoke release
  - query trusted root / release by version / release by root
  - policy pause state query
- Add role/signature enforcement for registry-mutating actions.
- Add replay/idempotency tests for registry writes.
- Add authority and audit commitment actions for the v1.4.0 workflow.

Acceptance:
- AO tests prove trusted/untrusted/revoked root transitions.
- Gateway can fetch a stable trusted-root snapshot from AO.

Progress notes:
- AO registry actions and authority/audit extensions remain the open work.
- Gateway consumers are waiting on the final stable AO snapshot/API shape; no further gateway-side unblocker is expected here.

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
- Restore from checkpoint when AO fetch fails; fall back to env state only when no checkpoint exists.

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

Progress notes:
- Gateway incident actions can enforce role-aware `signatureRef` (`pause/resume` -> emergency/root; `ack/report` -> reporter/emergency/root).
- Authorization refs are sourced from AO snapshot authority and can be safely overlapped via `GATEWAY_INTEGRITY_ROLE_*_REFS` during rotation windows.
- Operator runbook added: `ops/integrity-runbook.md`.

### P1.2 Audit commitments stream
- Implement AO audit commitment entries (`seqFrom/seqTo/merkleRoot/metaHash`).
- Correlate gateway events with AO commitment sequences.

Progress notes:
- Gateway now exports audit sequence and lag gauges from integrity snapshots:
  - `gateway_integrity_audit_seq_from`
  - `gateway_integrity_audit_seq_to`
  - `gateway_integrity_audit_lag_seconds`
  - `gateway_integrity_checkpoint_age_seconds`
- Remaining work is the AO-side commitment sequencing and immutable audit stream/query API.

### P1.3 Signed local checkpoint (gateway)
- Persist last valid integrity snapshot with signature/hash.
- Restore only if the checkpoint verifies and is younger than the max-age policy.
- Treat stale checkpoints as absent so AO fetch remains the source of truth.

Progress notes:
- Checkpoint envelope now includes signed metadata (`writtenAt`, optional `expiresAt`).
- Max-age policy via `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS` fails closed on stale/invalid checkpoint data.
- Legacy checkpoint envelope compatibility is preserved when max-age enforcement is not configured.

### P1.4 Incident/reporting hooks
- Add incident action path and metrics pipeline.
- Add operator runbook for pause/resume and incident ack.

Progress notes:
- `POST /integrity/incident` supports authenticated `report|ack|pause|resume`.
- `GET /integrity/state` exposes runtime policy state and latest AO/checkpoint snapshot envelope.
- Metrics added: incident accepted/auth-blocked/notify ok/notify fail + state read/auth-blocked.
- Coverage added in `tests/integrity-incident.test.ts`.
- Replay/idempotency dedupe and the smoke helper are in place; remaining work is operator automation and final staging evidence.
- Operator automation now includes helper scripts for evidence export/validation/bundle checks plus workflow dispatch dry-run (`dispatch-consistency-smoke`, `latest-evidence-bundle`, `check-evidence-bundle`).

## P2 - Performance and platform polish (WEDOS-first)

### P2.1 Verification scheduling optimizations
- Verify on startup/cache-fill/state-change only.
- Add bounded refresh strategy for hot artifacts.

Progress notes:
- Integrity fetch client now supports bounded timeout + retry/backoff controls:
  - `AO_INTEGRITY_FETCH_TIMEOUT_MS`
  - `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS`
  - `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS`
- Profiled cadence defaults are now available via `GATEWAY_RESOURCE_PROFILE=wedos_small|wedos_medium|diskless`.
- Precedence is explicit: call override > `AO_INTEGRITY_FETCH_*` env > `GATEWAY_RESOURCE_PROFILE` > medium fallback.
- Alert guidance is now calibrated per profile in `ops/alerts-profiles.md`.
- Validation errors still fail closed immediately (no retry on invalid snapshot payloads).
- No open gateway-side follow-up remains beyond AO-side cadence/input finalization.

### P2.2 Resource budgets and limits
- Cap verifier CPU/timeouts.
- Bound cache size, ratelimit bucket cardinality, replay-window growth, and checkpoint history length.
- Add stress tests for constrained memory and limited-hosting profiles.

Progress notes:
- Cache admission bounds implemented (`GATEWAY_CACHE_MAX_ENTRY_BYTES`, `GATEWAY_CACHE_MAX_ENTRIES`).
- Ratelimit/replay map growth bounds implemented (`GATEWAY_RL_MAX_BUCKETS`, `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS`).
- Focused stress/hardening tests added:
  - `tests/rate-replay-limits.test.ts`
  - `tests/resource-hardening.test.ts`
- Budget observability completed:
  - cache reject reason counters
  - ratelimit/replay prune counters and config gauges
- Production presets documented in `ops/resource-budgets.md` and `config/example.env`.
- This slice is complete on the gateway side; remaining work is mostly deployment evidence and AO-side rollout coupling.

### P2.3 Optional diskless mode
- Ensure gateway works even without local checkpoint writes.
- Keep correctness through AO fetch + memory-only verification.
- Prefer tmpfs or no checkpoint path over fragile persistent storage on small hosts.

Progress notes:
- Explicit memory-only operation is now available via:
  - `GATEWAY_INTEGRITY_DISKLESS=1`, or
  - `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless|disabled|memory-only`
- In memory-only mode checkpoint read/write paths no-op safely (AO + env fallback remain active).
- Integration coverage includes diskless mode behavior when AO is unavailable (`tests/integrity-policy-gate.test.ts`).
- No additional gateway-side code remains for the optional diskless path.

## P3 - Nice-to-have / ecosystem scale

- Multi-region verifier consistency checks.
- Cross-gateway attestation exchange.
- Additional formal validation of integrity state transitions.

### P3 execution layer
- Mirror consistency checks across gateways to compare integrity snapshots and catch drift early.
- Cross-gateway compare tooling for operator spot checks and escalation evidence.
- Adaptive per-prefix route rate limits for tenant-aware burst control on hot paths.

Progress notes:
- P3 consistency tooling is now tracked end-to-end: compare output, attestation JSON, and manual smoke dispatch are the evidence targets; implementation is still in flight.
- Preferred P3 operator path is now evidence export first, attestation validation second, then manual dispatch only when the bundle is complete.
- CI `evidence-dry-run` now exercises the same export + validation chain to catch operator workflow drift before manual dispatch.
- CI `evidence-dry-run` also exercises latest-bundle selection, strict bundle checks, and workflow dispatch payload dry-run to keep the full operator chain regression-safe.
- New helper scripts now cover the operator-facing P3 loop:
  - `scripts/compare-integrity-matrix.js` for pairwise/all-gateway drift checks.
  - `scripts/build-attestation-exchange-pack.js` for cross-gateway evidence exchange bundles.
  - `scripts/index-evidence-bundles.js` for strict/portable bundle indexing (JSON/CSV).
  - `scripts/suggest-ratelimit-overrides.js` for profile-aware rate-limit override suggestions from traffic stats.
- CI wiring now exercises these helpers in `consistency-smoke` / `evidence-dry-run` (matrix compare + strict index + exchange-pack generation + help coverage).
- `consistency-smoke` now captures matrix JSON, generates a profile-aware drift report (`build-drift-alert-summary`), appends it to the job summary, and uploads consistency artifacts.
- `evidence-dry-run` now uploads its generated evidence directory as a CI artifact for offline review/sign-off.
- Weekly scheduled consistency smoke is enabled in CI (requires `CONSISTENCY_URLS`; optional `CONSISTENCY_MODE` and `GATEWAY_RESOURCE_PROFILE`).

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
