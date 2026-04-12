# Final Migration Summary

Use this document as the canonical human-readable summary for the final kernel migration state. Keep the wording specific, timestamped, and backed by stable evidence links.

## Migration overview

- **Project:** `blackcat-darkmesh-gateway`
- **Legacy source:** `blackcat-kernel-contracts`
- **Target architecture:** `AO + gateway + write`
- **Summary date (UTC):** `2026-04-12T16:35:12Z`
- **Prepared by:** `@jaine`
- **Release / milestone:** `1.4.0-precloseout`

## Scope completed

Describe what was migrated, stabilized, or decommissioned.

- **Included systems:**
  - Gateway-owned runtime boundaries for config, core primitives, crypto verification, auth policy, session/replay controls, template guardrails, webhook hardening, mailing guards, telemetry policy, and payments validators.
  - Legacy snapshot archive relocation from `libs/legacy/` to `kernel-migration/legacy-archive/snapshots/` with manifest + boundary tool updates.
  - Operator diagnostics and release-drill ergonomics (`run-release-drill` auto output directory handling, worker map config examples, forget-forward example env).
- **Excluded systems:**
  - AO-side authority lifecycle closeout (`publish/revoke/query/pause`, authority rotation completion, immutable audit commitments query surface).
  - Final production worker map values and per-site secret material (kept outside repository by design).
  - Final stakeholder approvals (security, operations, architecture, product owner) pending closeout evidence.
- **Key architecture changes:**
  - Runtime now fail-closes before request forwarding when template payloads include secret-smuggling patterns.
  - Worker signing path enforces signature-ref coherence across URL/token/signature maps.
  - Legacy modules are retained as immutable archive snapshots, not request-path dependencies.
- **User-facing changes:**
  - `/template/call` now provides stricter upstream safety checks and deterministic rejection reasons for unsafe payloads.
  - `/cache/forget` keeps local purge availability even when optional worker forwarding fails or times out.
  - Security-hardening controls are profile-aware for WEDOS-like environments via explicit env-driven limits.

## Current hardening notes

- Template request handling now fail-closes on recursive secret-smuggling fields before any upstream fetch.
- The local forget path remains `200` even when optional per-site worker forwarding times out or fails, so public purge stays available without coupling it to the worker relay.
- The gateway-owned core hash primitive is now documented and tested via `src/runtime/core/hash.ts` and `tests/runtime-core-hash.test.ts`.
- `tsconfig.json` has moved to `NodeNext`, which removes the `moduleResolution=node10` deprecation warning path and keeps the editor/build toolchain aligned for the next TypeScript line.
- Template worker routes now enforce `signatureRef` pinning where a site map exists, and the URL/token/signatureRef map-coherence validator keeps release routing inputs aligned before publish.
- The forget-forward config validator keeps the optional worker relay explicit and bounded, so the local purge path and the worker relay can be audited independently.
- Release-drill evidence now includes the expanded metadata pack (`release-drill-manifest.json`, strict manifest validation output, `release-drill-check.json`, `release-drill-checks.json`) for machine-auditable closeout.
- AO registry/authority lifecycle blockers remain open and should still be tracked separately in the decommission evidence bundle.

## Evidence pack

Link only to immutable or stable artifacts.

| Evidence item | UTC timestamp | Link | Notes |
| --- | --- | --- | --- |
| Final release drill | `2026-04-12T16:35:12Z` | `kernel-migration/release-drill-manifest.json` | Pending generation in next drill run; runbook already updated. |
| Release evidence ledger | `2026-04-12T16:35:12Z` | `kernel-migration/release-evidence-ledger.json` | Pending generation; build script is available. |
| CI run / workflow | `2026-04-12T16:35:12Z` | `.github/workflows/ci.yml` | Implementation tests and strict boundary checks are green locally. |
| Staging / production-like validation | `2026-04-12T16:35:12Z` | `kernel-migration/DECOMMISSION_CHECKLIST.md` | Ready to execute after AO/manual blockers clear. |
| Manual operator proof | `2026-04-12T16:35:12Z` | `kernel-migration/SIGNOFF_RECORD.md` | Reserved for final stakeholder signoff package. |

## Rollback reference

Record the exact rollback path, including the artifact that defines it.

- **Rollback reference:** `ops/release-drill-runbook.md`
- **Rollback owner:** `gateway-ops-oncall`
- **Rollback command / procedure:** `revert release PR, redeploy previous gateway artifact, then run npm test and integrity gates before reopening traffic`
- **Rollback evidence link:** `ops/release-drill-runbook.md`
- **Rollback tested at (UTC):** `2026-04-12T16:35:12Z`

## Approvals

List the people who reviewed the migration and the evidence used for their approval.

| Role | Name / handle | UTC approval time | Evidence reviewed | Decision |
| --- | --- | --- | --- | --- |
| Security | `security-review-pending` | `2026-04-12T16:35:12Z` | `legacy boundary evidence + runtime hardening test report` | `blocked` |
| Operations | `ops-review-pending` | `2026-04-12T16:35:12Z` | `release drill runbook + decommission checklist` | `blocked` |
| Architecture | `architecture-review-pending` | `2026-04-12T16:35:12Z` | `AO dependency gate + migration summary` | `blocked` |
| Product / owner | `owner-review-pending` | `2026-04-12T16:35:12Z` | `signoff record + release readiness report` | `blocked` |

## Residual risks

Be explicit. If a risk is deferred, say why and how it is monitored.

- **Residual risk:** `AO authority lifecycle remains open, so closeout readiness cannot be marked complete.`
- **Impact:** `high`
- **Likelihood:** `medium`
- **Mitigation:** `Keep NO-GO status, preserve strict gateway boundaries, and block final release signoff until AO checks are closed with evidence links.`
- **Monitoring / alerting:** `Track ao-dependency-gate + decommission readiness checks in each release drill iteration.`
- **Expiry / revisit date (UTC):** `2026-04-19T00:00:00Z`

## Decommission decision

- **Decision:** `NO-GO`
- **Decision time (UTC):** `2026-04-12T16:35:12Z`
- **Final status:** `blocked`
- **Automation state:** `blocked`
- **AO/manual state:** `pending`
- **Blockers remaining:** `missing release drill artifact set and AO dependency gate checks still in_progress`
- **Archive / cleanup reference:** `commit 0711082 (legacy archive relocation and boundary tooling updates)`

## Operator notes

- Keep every evidence link stable and reviewable after the migration window closes.
- Record closeout evidence in the same order as the validators: drill manifest, manifest validation, drill artifact check, evidence ledger/log, readiness, AO gate evidence, then sign-off.
- If the decision is `NO-GO`, include the exact blocker and the next verification step.
- If the automation finished but AO/manual proof links are still open, record that explicitly as `automation-complete` plus `ao-manual-pending` instead of collapsing it into a generic blocked note.
- If the decision is `GO`, the rollback reference must still be present and reachable.
