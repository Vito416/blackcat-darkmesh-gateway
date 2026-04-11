# Decommission Checklist for `blackcat-kernel-contracts`

Do not archive/delete the old repo until all checks below are complete.

Gateway-side implementation and test coverage are ahead of the AO-side registry/authority lifecycle, so the remaining deletion gate is still blocked on the AO API and rollout evidence.

Machine-validated release evidence can now be generated, but it does not close the AO-side blockers by itself. Keep the AO registry/authority items open until the underlying APIs and lifecycle flows are actually complete.

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

- Before go/no-go, the evidence bundle should contain:
  - Compare run output captured from `npm run ops:compare-integrity`.
  - Attestation JSON archived for the compare run with snapshot ids and consensus result.
  - Validation result showing the attestation artifact passed schema/consistency checks.
  - Manual consistency smoke `workflow_dispatch` link and log recorded with timestamp and operator.
  - Bundle manifest with the export command, URLs, and artifact paths.
  - Stable archive link for the final evidence bundle or release note.

Pass criteria:
- compare exits `0` and shows no drift
- attestation export exits `0`
- validation exits `0`
- manual smoke dispatch is accepted and the workflow run ends green
- archive links resolve to the exact bundle used for review

Fail criteria:
- any compare/attestation/validation command returns non-zero
- the smoke dispatch is rejected or ends red
- any required artifact is missing, overwritten, or only exists as a local note

- [ ] Compare run artifact captured from `npm run ops:compare-integrity`.
- [ ] Attestation JSON archived for the compare run with snapshot ids and consensus result.
- [ ] Validation log captured for `npm run ops:validate-integrity-attestation`.
- [ ] Manual consistency smoke `workflow_dispatch` link recorded with timestamp and operator.
- [ ] Bundle manifest archived with exact command, URLs, and artifact paths.
- [ ] Stable archive link recorded for the final evidence bundle.

### D.2 Machine-validated release evidence

- Preferred operator path is `scripts/run-release-drill.js`; it produces and archives the matrix, drift report/summary, release pack, signoff checklist, and readiness JSON as the canonical drill bundle.
- The archived drill bundle must include `release-drill-manifest.json` and the strict validation output from the run.
- The release pack should be built with `npm run ops:build-release-evidence-pack` (or `node scripts/build-release-evidence-pack.js`) and archived as `release-evidence-pack.md` plus `release-evidence-pack.json`.
- The AO dependency gate should be validated with `node scripts/validate-ao-dependency-gate.js --file kernel-migration/ao-dependency-gate.json`; this proves the JSON is well formed, but it does not mean the AO lifecycle work is done.
- The release sign-off checklist should be generated with `node scripts/build-release-signoff-checklist.js --pack <release-evidence-pack.json> [--strict]` so the pack status and blockers are machine summarized.
- Consistency drift evidence should include the markdown drift report and JSON drift summary from `node scripts/build-drift-alert-summary.js` (`consistency-drift-report.md`, `consistency-drift-summary.json`).
- Mandatory archive artifacts for the drill/evidence bundle: matrix, drift report/summary, release pack, signoff checklist, readiness JSON, `release-drill-manifest.json`, strict validation output.

Pass criteria:
- release pack status is `ready`
- AO gate validation exits `0`
- sign-off checklist is generated from the same pack and reflects the current blockers
- consistency drift report and summary match the archived compare run

Manual evidence still required separately:
- recovery drill timestamps
- AO fallback drill proof
- rollback proof for at least one failure scenario
- stakeholder approvals/sign-off

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
