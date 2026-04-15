# P1 Runbook Debt Backlog (P1-01..P1-06)

Status date: 2026-04-15
Scope: gateway + AO + write + worker operational maturity after hardening batch.

Legend:
- `[ ]` open
- `[~]` in progress
- `[x]` closed

## P1-01 Worker token scope rotation runbook
- [~] Document strict scoped token rollout (`WORKER_READ_TOKEN`, `WORKER_FORGET_TOKEN`, `WORKER_NOTIFY_TOKEN`, `WORKER_SIGN_TOKEN`) with zero-downtime overlap and rollback steps.
- Owner: worker ops (`blackcat-darkmesh-ao/worker`).
- Evidence target: staged rotation transcript + `worker` test run in release artifacts.
- Latest hardening batch: `ops/decommission/P1_FIX_BATCH_2026-04-15.md` (token-topology fail-closed checks landed).

## P1-02 Worker replay contention drill
- [~] Add operator drill for replay guard contention path (claim collision, expected `409 replay`, recovery expectations, metric interpretation).
- Owner: worker ops.
- Evidence target: replay drill log with before/after metrics snapshot.
- Latest hardening batch: `ops/decommission/P1_FIX_BATCH_2026-04-15.md` (claim-marker ownership check + concurrency regression test landed).

## P1-03 Gateway AO outage behavior drill
- [x] Validate and document AO resolver outage path (negative-cache TTL + circuit-breaker open/close windows).
- Owner: gateway ops.
- Evidence target: strict drill artifact proving `site_resolver_unavailable` and `site_resolver_circuit_open` behavior.
- Evidence: `ops/decommission/P1_FIX_BATCH_2026-04-15.md` (+ resolver regression tests).

## P1-04 AO registry write fail-closed type-guard audit
- [x] Complete write-handler field-type audit for `Site-Id` and other key identity fields; keep malformed writes fail-closed.
- Owner: AO ops (`blackcat-darkmesh-ao`).
- Evidence target: contract/health run output plus regression notes in AO deploy notes.
- Evidence: `ops/decommission/P1_FIX_BATCH_2026-04-15.md` (+ AO contract regressions for non-string/conflicting Site-Id aliases).

## P1-05 Cross-repo outage/recovery choreography
- [ ] Run one coordinated drill covering gateway -> AO public API fallback, write forwarding, and worker signing/notify boundaries under degraded AO conditions.
- Owner: cross-repo ops.
- Evidence target: single drill bundle with trace correlation and clear pass/fail matrix.

## P1-06 Final operator closeout packaging
- [ ] Fold P1-01..P1-05 outputs into the decommission/release evidence chain (`release-evidence-pack`, readiness checks, signoff checklist).
- Owner: gateway release ops.
- Evidence target: updated closeout bundle with no open P1 runbook debt.

## Current execution order
1. P1-04 + P1-03 (already in active hardening batch)
2. P1-01 + P1-02
3. P1-05
4. P1-06 (closeout packaging)
