# Final Migration Summary

Use this document as the canonical human-readable summary for the final kernel migration state. Keep the wording specific, timestamped, and backed by stable evidence links.

## Migration overview

- **Project:** `blackcat-darkmesh-gateway`
- **Legacy source:** `blackcat-kernel-contracts`
- **Target architecture:** `AO + gateway + write`
- **Summary date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`
- **Prepared by:** `@operator-handle`
- **Release / milestone:** `1.4.0` or `1.2.1` or final release tag

## Scope completed

Describe what was migrated, stabilized, or decommissioned.

- **Included systems:**
  - `...`
- **Excluded systems:**
  - `...`
- **Key architecture changes:**
  - `...`
- **User-facing changes:**
  - `...`

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
| Final release drill | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| Release evidence ledger | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| CI run / workflow | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| Staging / production-like validation | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| Manual operator proof | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |

## Rollback reference

Record the exact rollback path, including the artifact that defines it.

- **Rollback reference:** `...`
- **Rollback owner:** `...`
- **Rollback command / procedure:** `...`
- **Rollback evidence link:** `...`
- **Rollback tested at (UTC):** `YYYY-MM-DDTHH:MM:SSZ`

## Approvals

List the people who reviewed the migration and the evidence used for their approval.

| Role | Name / handle | UTC approval time | Evidence reviewed | Decision |
| --- | --- | --- | --- | --- |
| Security | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |
| Operations | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |
| Architecture | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |
| Product / owner | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |

## Residual risks

Be explicit. If a risk is deferred, say why and how it is monitored.

- **Residual risk:** `...`
- **Impact:** `low / medium / high`
- **Likelihood:** `low / medium / high`
- **Mitigation:** `...`
- **Monitoring / alerting:** `...`
- **Expiry / revisit date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`

## Decommission decision

- **Decision:** `GO` / `NO-GO`
- **Decision time (UTC):** `YYYY-MM-DDTHH:MM:SSZ`
- **Final status:** `complete / partial / blocked`
- **Automation state:** `complete / blocked`
- **AO/manual state:** `complete / pending / blocked`
- **Blockers remaining:** `...`
- **Archive / cleanup reference:** `...`

## Operator notes

- Keep every evidence link stable and reviewable after the migration window closes.
- Record closeout evidence in the same order as the validators: drill manifest, manifest validation, drill artifact check, evidence ledger/log, readiness, AO gate evidence, then sign-off.
- If the decision is `NO-GO`, include the exact blocker and the next verification step.
- If the automation finished but AO/manual proof links are still open, record that explicitly as `automation-complete` plus `ao-manual-pending` instead of collapsing it into a generic blocked note.
- If the decision is `GO`, the rollback reference must still be present and reachable.
