# Decommission Checklist for `blackcat-kernel-contracts`

Do not archive/delete the old repo until all checks below are complete.

Gateway-side implementation and test coverage are ahead of the AO-side registry/authority lifecycle, so the remaining deletion gate is still blocked on the AO API and rollout evidence.

## A. Knowledge preservation

- [ ] Kernel source snapshot commit is recorded in this folder.
- [ ] Critical docs copied into `kernel-migration/upstream/`.
- [ ] Port scope mapping approved (`KERNEL_PORT_SCOPE.md`).
- [ ] AO/Gateway target design approved (`AO_GATEWAY_DESIGN.md`).

## B. Functional parity

- [ ] Trusted release registry logic is available via AO APIs.
- [ ] Revoke semantics are enforced by gateway verifier.
- [x] Pause/degraded mode policy is enforced in gateway runtime.
- [ ] Upgrade lifecycle equivalent (`propose/activate/cancel`) is implemented in AO/write flows.
- [ ] Compatibility rollback policy is implemented or explicitly deferred with documented risk.

## C. Security parity

- [ ] Authority separation (`root/upgrade/emergency/reporter`) exists in AO policy model.
- [ ] Key rotation procedure is implemented and tested.
- [x] Replay/idempotency checks exist for privileged integrity actions.
- [x] Incident path exists (report + operational response).

## D. Observability

- [x] Integrity metrics are exposed and scraped.
- [x] Alert thresholds are defined for integrity failures and paused mode.
- [ ] Audit commitments (or equivalent immutable integrity proofs) are produced and queryable.

### D.1 Cross-gateway consistency evidence

- [ ] Compare run artifact captured from `npm run ops:compare-integrity`.
- [ ] Attestation JSON archived for the compare run with snapshot ids and consensus result.
- [ ] Manual consistency smoke `workflow_dispatch` link recorded with timestamp and operator.

## E. Test parity

- [ ] Kernel-derived parity scenarios are ported into AO/gateway tests.
- [x] CI contains integrity-focused tests (not only basic unit coverage).
- [x] CI integrity tests pass for `integrity-client`, `integrity-verifier`, `integrity-policy-gate`, `integrity-checkpoint`, and `integrity-parity`.
- [ ] Negative tests cover revoked root, hash mismatch, missing authority, stale state.
- [ ] Checkpoint tamper test passes and fails closed on signature mismatch.

## F. Operational readiness

- [x] Runbook includes:
  - [x] key rotation
  - [x] emergency pause/unpause
  - [x] degraded mode behavior
  - [x] recovery from AO outage
- [ ] WEDOS/shared-hosting limits are validated (resource and runtime model).
- [ ] Recovery drill completed at least once in staging with timestamps captured in notes.
- [ ] Key rotation drill completed at least once for each integrity role.
- [ ] AO fetch fallback was exercised and resumed without manual state repair.

## G. Final gate before deletion

- [ ] Stakeholder sign-off: security (`1` documented approval, no open critical findings, no unresolved auth/rotation gaps).
- [ ] Stakeholder sign-off: operations (`1` documented approval, runbook and recovery drill verified, on-call knows rollback path).
- [ ] Stakeholder sign-off: architecture (`1` documented approval, target state and decommission scope match the approved design).
- [ ] P0 integrity rollout complete with `npm test` + focused integrity tests green on the current branch.
- [ ] Final migration summary committed in gateway + AO notes with date, scope, and rollback reference.
- [ ] Rollback plan documented and tested in staging for at least one failure scenario.
- [ ] No open P0/P1 migration blockers remain in backlog.
- [ ] The old repo has been dry-run archived or mirrored with a verified restore path before deletion.

## H. Evidence log template

Use one row per drill or proof item. Keep the artifact link stable and prefer the raw log, PR, or release note URL.

| Drill name | Date/time UTC | Operator | Command/script | Artifact link | Status |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | pending |
|  |  |  |  |  | pending |
|  |  |  |  |  | pending |

## I. Evidence quality rubric

- Acceptable proof: raw CI log, terminal log, PR link, release note, or staging artifact with a stable permalink.
- Every proof should show the command/script, UTC timestamp, operator, and the exact expected outcome.
- Preferred proof links include immutable artifacts: workflow run, commit, release, or raw log; avoid screenshots unless they supplement a stronger artifact.
- Not enough: paraphrased notes, chat snippets without a permalink, or files that can be edited in place without history.

## J. Go / No-Go decision template

- Decision: `GO` / `NO-GO`
- Date (UTC):
- Approvers:
- Reviewed evidence:
- Remaining blockers:
- Rollback reference:
- Notes:

## Recommended deletion sequence

1. Archive old repo (read-only) for a cooling-off period.
2. Run production-like tests without referencing old repo.
3. If stable, delete archived repo or keep long-term read-only mirror.

For safety, archiving first is strongly preferred over immediate hard deletion.
