# Decommission Checklist for `blackcat-kernel-contracts`

Do not archive/delete the old repo until all checks below are complete.

Gateway-side implementation and test coverage are ahead of the AO-side registry/authority lifecycle, so the remaining deletion gate is still blocked on the AO API and rollout evidence.

Machine-validated release evidence can now be generated, but the readiness tooling intentionally splits the result into two phases: `automation-complete` for the archive/build/drill evidence, and `ao-manual-pending` / `ao-manual-blocked` when AO-side checks or proof links are still open. Use that split in notes and logs instead of a generic "blocked" label whenever the automation itself has already finished.

Latest hardening wave notes to keep visible during closeout:

- `/template/call` now scans payloads recursively and fails closed on secret-smuggling fields before any upstream fetch.
- `/cache/forget` still returns `200` for the local purge path even if the optional worker forward skips, times out, or fails.
- Gateway-owned hash evidence for `blackcat-core` is now anchored by `src/runtime/core/hash.ts` and `tests/runtime-core-hash.test.ts`.
- `tsconfig.json` has moved to `NodeNext`, which removes the old `moduleResolution=node10` deprecation warning path at the source.
- Template worker routing now enforces `signatureRef` pinning at runtime when a site is mapped, and the map-coherence validator keeps the URL/token/signatureRef entries aligned before publish.
- `check-forget-forward-config` makes the optional forget relay explicit, bounded, and fail-closed on malformed config without changing the local purge path semantics.
- Release-drill evidence now captures expanded metadata (`release-drill-manifest.json`, strict manifest validation output, `release-drill-check.json`, `release-drill-checks.json`) so the bundle stays machine-auditable.

These hardening notes are operational evidence only; they do not close the AO/manual blockers below.

## Legacy module exit criteria

For each module below, require the same three proof types before marking it retired: (1) replacement path evidence, (2) targeted test log with exit code `0`, and (3) `rg` output showing no request-path import from `libs/legacy/<module>` in `src/`. Attach one global runtime-boundary proof per bundle: `npm run ops:check-legacy-runtime-boundary -- --strict` with `Findings: 0`.

| Legacy module | Module-specific proof expectations |
| --- | --- |
| `blackcat-config` | Replacement in `src/runtime/config/`; pass `tests/runtime-config-loader.test.ts`, `tests/runtime-config-profile.test.ts`, and `tests/profile-tuning-sync.test.ts`; attach `rg -n "libs/legacy/blackcat-config" src` output. |
| `blackcat-core` | Replacement in `src/runtime/core/` and template helpers in `src/runtime/template/`; keep `kernel-migration/core-primitive-map.json` aligned with the gateway runtime, pass `tests/runtime-core-bytes.test.ts`, `tests/runtime-core-json.test.ts`, `tests/runtime-core-canonicalJson.test.ts`, `tests/runtime-core-hash.test.ts`, `tests/template-api.test.ts`, and `tests/validate-template-backend-contract.test.ts`; attach `rg -n "libs/legacy/blackcat-core" src` output. |
| `blackcat-crypto` | Replacement in `src/runtime/crypto/`; pass `tests/runtime-crypto-safeCompare.test.ts`, `tests/runtime-crypto-hmac.test.ts`, `tests/runtime-crypto-signatureRefs.test.ts`, and `tests/webhooks.test.ts`; attach `rg -n "libs/legacy/blackcat-crypto" src` output plus runtime boundary proof (`verification-only`, no wallet/private-key signing). |
| `blackcat-auth` | Replacement in `src/runtime/auth/`; pass `tests/runtime-auth-httpAuth.test.ts`, `tests/runtime-auth-policy.test.ts`, and `tests/metrics-auth.test.ts`; attach `rg -n "libs/legacy/blackcat-auth" src` output. |
| `blackcat-sessions` | Replacement in `src/runtime/sessions/`; pass `tests/runtime-sessions-replayStore.test.ts`, `tests/runtime-sessions-lifecycle.test.ts`, and `tests/rate-replay-limits.test.ts`; attach `rg -n "libs/legacy/blackcat-sessions" src` output. |
| `blackcat-auth-js` | Gateway-owned client boundary exists (`src/clients/auth-sdk/` or documented equivalent); pass `tests/clients-auth-sdk.test.ts`; attach `rg -n "libs/legacy/blackcat-auth-js" src` output. |
| `blackcat-crypto-js` | Gateway-owned client boundary exists (`src/clients/crypto-sdk/` or documented equivalent); pass `tests/clients-crypto-sdk.test.ts`; attach `rg -n "libs/legacy/blackcat-crypto-js" src` output. |
| `blackcat-mailing` | Replacement in `src/runtime/mailing/`; pass `tests/runtime-mailing-policy.test.ts`, `tests/runtime-mailing-transport.test.ts`, `tests/runtime-mailing-delivery.test.ts`, `tests/runtime-mailing-integration.test.ts`, and `tests/check-mailing-secret-boundary.test.ts`; attach `rg -n "libs/legacy/blackcat-mailing" src` output plus `npm run ops:check-mailing-secret-boundary -- --strict`. |
| `blackcat-gopay` | Replacement in `src/runtime/payments/`; pass `tests/runtime-payments-validators.test.ts` and `tests/handler-gopay-webhook.test.ts`; attach `rg -n "libs/legacy/blackcat-gopay" src` output. |
| `blackcat-analytics` | Replacement in `src/runtime/telemetry/analytics/`; pass `tests/runtime-telemetry-analytics.test.ts`; attach `rg -n "libs/legacy/blackcat-analytics" src` output. |
| `blackcat-installer` | Explicit ops-only classification (`ops/` + `scripts/` references only); pass `npm run ops:check-installer-runtime-boundary -- --strict`; attach `rg -n "blackcat-installer|libs/legacy/blackcat-installer" src` output showing no request-path usage. Treat this as a do-not-port candidate unless scope is explicitly approved. |

## A. Knowledge preservation

- [ ] Kernel source snapshot commit is recorded in this folder.
- [ ] Critical docs copied into `kernel-migration/upstream/`.
- [ ] Port scope mapping approved (`KERNEL_PORT_SCOPE.md`).
- [ ] AO/Gateway target design approved (`AO_GATEWAY_DESIGN.md`).

## B. Functional parity

- [ ] Trusted release registry logic is available via AO APIs.
- [ ] Closeout automation is complete and AO/manual proof state is recorded separately (`automation-complete` vs `ao-manual-pending` / `ao-manual-blocked`).
- [ ] Revoke semantics are enforced by gateway verifier.
- [x] Pause/degraded mode policy is enforced in gateway runtime.
- [ ] Upgrade lifecycle equivalent (`propose/activate/cancel`) is implemented in AO/write flows.
- [ ] Compatibility rollback policy is implemented or explicitly deferred with documented risk.

## C. Security parity

- [ ] Authority separation (`root/upgrade/emergency/reporter`) exists in AO policy model.
- [ ] Key rotation procedure is implemented and tested.
- [ ] Template-backend contract is defined and validated before legacy repos are retired.
- [x] Replay/idempotency checks exist for privileged integrity actions.
- [x] Incident path exists (report + operational response).

### C.1 Worker-routing and trust-model boundary

- `check-template-worker-routing-config` validates the published tenant URL/token map before routing is published.
- `check-template-signature-ref-map` and the routing-map coherence checks keep the URL/token/signatureRef maps in sync before release artifacts are published.
- `init-template-worker-routing` is scaffold-only and prepares a routing set without changing trust policy.
- `validate-worker-secrets-trust-model` is the machine companion to `ops/worker-secrets-trust-model.md` and should remain a strict gate once wired into release checks.
- `check-forget-forward-config` documents the optional forget relay contract and should stay separate from the local forget-path proof.
- Before final decommission, archive the final routing map/token map, the trust-model validation log, and proof that worker secrets stayed out of request-path runtime.

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

- Preferred operator path is `scripts/run-release-drill.js`; it produces and archives the matrix, drift report/summary, AO gate validation output, release pack, signoff checklist, readiness JSON, drill manifest, drill artifact-check output, and release evidence ledger as the canonical drill bundle.
- The archived drill bundle must include `release-drill-manifest.json`, strict manifest validation output, `release-drill-check.json`, and `release-evidence-ledger.md/.json`.
- The drill bundle also records the expanded metadata pack (`release-drill-checks.json`) so follow-up audits can verify what was checked without re-running the drill.
- The release pack should be built with `npm run ops:build-release-evidence-pack` (or `node scripts/build-release-evidence-pack.js`) and archived as `release-evidence-pack.md` plus `release-evidence-pack.json`.
- The AO dependency gate should be validated with `node scripts/validate-ao-dependency-gate.js --file kernel-migration/ao-dependency-gate.json` and archived as `ao-dependency-gate.validation.txt`; this proves the JSON is well formed, but it does not mean the AO lifecycle work is done.
- The release sign-off checklist should be generated with `node scripts/build-release-signoff-checklist.js --pack <release-evidence-pack.json> [--strict]` so the pack status and blockers are machine summarized.
- Consistency drift evidence should include the markdown drift report and JSON drift summary from `node scripts/build-drift-alert-summary.js` (`consistency-drift-report.md`, `consistency-drift-summary.json`).
- Mandatory archive artifacts for the drill/evidence bundle: matrix, drift report/summary, `ao-dependency-gate.validation.txt`, release pack, signoff checklist, readiness JSON, `release-drill-manifest.json`, strict validation output, `release-drill-check.json`, `release-evidence-ledger.md`, `release-evidence-ledger.json`.
- Validator flow for closeout evidence is fixed: `build-release-drill-manifest` -> `validate-release-drill-manifest` -> `check-release-drill-artifacts` -> `build-release-evidence-ledger` / `build-decommission-evidence-log` -> `check-decommission-manual-proofs` -> `check-decommission-readiness` -> `check-ao-gate-evidence`.
- If automation passes but AO/manual proof links are still missing, record `automation-complete` plus `ao-manual-pending`; if the proof links are known missing or invalid, record `ao-manual-blocked` rather than collapsing it into a generic blocked state.

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

- [x] Kernel-derived parity scenarios are ported into AO/gateway tests.
- [x] CI contains integrity-focused tests (not only basic unit coverage).
- [x] CI integrity tests pass for `integrity-client`, `integrity-verifier`, `integrity-policy-gate`, `integrity-checkpoint`, and `integrity-parity`.
- [x] Negative tests cover revoked root, hash mismatch, missing authority, stale state.
- [x] Checkpoint tamper test passes and fails closed on signature mismatch.

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
- [x] P0 integrity rollout complete with `npm test` + focused integrity tests green on the current branch.
- [ ] Final migration summary committed in gateway + AO notes with date, scope, and rollback reference.
- [ ] Final decommission closeout log recorded from `run-decommission-closeout` with manual proof links attached and the `automation-complete` / `ao-manual-pending` / `ao-manual-blocked` split explicitly recorded.
- [ ] Rollback plan documented and tested in staging for at least one failure scenario.
- [ ] No open P0/P1 migration blockers remain in backlog.
- [ ] The old repo has been dry-run archived or mirrored with a verified restore path before deletion.

## H. Evidence log template

Latest machine verification snapshot (UTC: `2026-04-11`):
- `npm run test:integrity-fast` → `SUCCESS 26/26 checks passed`
- `npm test` → `85 files, 509 tests passed`

Use one row per drill or proof item. Keep the artifact link stable and prefer the raw log, PR, or release note URL. The closeout automation can be complete even when AO/manual proofs are still pending; record that as `automation-complete` plus `ao-manual-pending` instead of compressing it into a single blocked state. If a manual proof is missing or invalid, mark it `ao-manual-blocked`.

| Drill name | Date/time UTC | Operator | Command/script | Artifact link | Automation state | AO/manual state | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decommission closeout automation |  |  | `run-decommission-closeout` |  | `automation-complete` | `ao-manual-pending` | `ao-manual-pending` |
|  |  |  |  |  | `automation-complete` | `complete` | `ready` |
|  |  |  |  |  | `automation-blocked` | `ao-manual-pending` | `automation-blocked` |
|  |  |  |  |  | `automation-complete` | `ao-manual-blocked` | `ao-manual-blocked` |

## I. Evidence quality rubric

- Acceptable proof: raw CI log, terminal log, PR link, release note, or staging artifact with a stable permalink.
- Every proof should show the command/script, UTC timestamp, operator, and the exact expected outcome.
- Preferred proof links include immutable artifacts: workflow run, commit, release, or raw log; avoid screenshots unless they supplement a stronger artifact.
- Not enough: paraphrased notes, chat snippets without a permalink, or files that can be edited in place without history.
- Automation evidence and AO/manual evidence should be logged separately even when they land in the same drill bundle; the closeout state is only `ready` when both halves are complete. If the AO/manual half is not yet usable, keep it in `ao-manual-pending` or `ao-manual-blocked` rather than generic blocked.

## J. Go / No-Go decision template

- Decision: `GO` / `NO-GO`
- Date (UTC):
- Approvers:
- Reviewed evidence:
- Remaining blockers:
- Rollback reference:
- Notes:

## K. Operator reference templates

Use these files as the final operator-facing closeout records once the evidence pack is complete:

- `kernel-migration/FINAL_MIGRATION_SUMMARY.md` — canonical migration closeout summary with UTC fields, evidence links, rollback reference, approvals, and residual risk notes.
- `kernel-migration/SIGNOFF_RECORD.md` — final approval record for the release/decommission decision trail.
- Keep both documents aligned with the archived drill bundle and the stable evidence links recorded in `kernel-migration/DECOMMISSION_CHECKLIST.md`.

## Recommended deletion sequence

1. Archive old repo (read-only) for a cooling-off period.
2. Run production-like tests without referencing old repo.
3. If stable, delete archived repo or keep long-term read-only mirror.

For safety, archiving first is strongly preferred over immediate hard deletion.
