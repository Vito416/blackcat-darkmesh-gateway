# Decommission Checklist for `blackcat-kernel-contracts`

Do not archive/delete the old repo until all checks below are complete.

## A. Knowledge preservation

- [ ] Kernel source snapshot commit is recorded in this folder.
- [ ] Critical docs copied into `kernel-migration/upstream/`.
- [ ] Port scope mapping approved (`KERNEL_PORT_SCOPE.md`).
- [ ] AO/Gateway target design approved (`AO_GATEWAY_DESIGN.md`).

## B. Functional parity

- [ ] Trusted release registry logic is available via AO APIs.
- [ ] Revoke semantics are enforced by gateway verifier.
- [ ] Pause/degraded mode policy is enforced in gateway runtime.
- [ ] Upgrade lifecycle equivalent (`propose/activate/cancel`) is implemented in AO/write flows.
- [ ] Compatibility rollback policy is implemented or explicitly deferred with documented risk.

## C. Security parity

- [ ] Authority separation (`root/upgrade/emergency/reporter`) exists in AO policy model.
- [ ] Key rotation procedure is implemented and tested.
- [ ] Replay/idempotency checks exist for privileged integrity actions.
- [ ] Incident path exists (report + operational response).

## D. Observability

- [ ] Integrity metrics are exposed and scraped.
- [ ] Alert thresholds are defined for integrity failures and paused mode.
- [ ] Audit commitments (or equivalent immutable integrity proofs) are produced and queryable.

## E. Test parity

- [ ] Kernel-derived parity scenarios are ported into AO/gateway tests.
- [ ] CI contains integrity-focused tests (not only basic unit coverage).
- [ ] Negative tests cover revoked root, hash mismatch, missing authority, stale state.

## F. Operational readiness

- [ ] Runbook includes:
  - [ ] key rotation
  - [ ] emergency pause/unpause
  - [ ] degraded mode behavior
  - [ ] recovery from AO outage
- [ ] WEDOS/shared-hosting limits are validated (resource and runtime model).

## G. Final gate before deletion

- [ ] Stakeholder sign-off: security
- [ ] Stakeholder sign-off: operations
- [ ] Stakeholder sign-off: architecture
- [ ] A final migration summary is committed in gateway + AO notes
- [ ] A rollback plan exists in case hidden dependency on old repo is discovered

## Recommended deletion sequence

1. Archive old repo (read-only) for a cooling-off period.
2. Run production-like tests without referencing old repo.
3. If stable, delete archived repo or keep long-term read-only mirror.

For safety, archiving first is strongly preferred over immediate hard deletion.
