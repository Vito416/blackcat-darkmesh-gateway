# Signoff Record

Use this record to capture final approval for the migration and decommission path. It should be filled only after the evidence pack is complete.

## Record metadata

- **Record date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`
- **Prepared by:** `@operator-handle`
- **Repo:** `blackcat-darkmesh-gateway`
- **Related release / tag:** `...`
- **Related migration summary:** `kernel-migration/FINAL_MIGRATION_SUMMARY.md`
- **Related checklist:** `kernel-migration/DECOMMISSION_CHECKLIST.md`

## Decision

- **Decision:** `GO` / `NO-GO`
- **Decision rationale:** `...`
- **Decision time (UTC):** `YYYY-MM-DDTHH:MM:SSZ`
- **Scope covered:** `...`
- **Scope excluded:** `...`

## Evidence reviewed

List the exact artifacts used for signoff.

| Artifact | UTC timestamp | Link | Notes |
| --- | --- | --- | --- |
| Final migration summary | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| Release evidence ledger | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| Release drill manifest | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| AO dependency gate validation | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| CI / workflow run | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |
| Rollback proof | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |

- The review set should preserve the evidence split: machine outputs first, then AO/manual proofs, with `automation-complete` and `ao-manual-pending` recorded separately if the two halves do not land together.
- The validator order should match the closeout path used in the checklist so the signoff trail can be replayed without interpretation drift.

## Approvals

| Role | Name / handle | UTC approval time | Evidence reviewed | Approval |
| --- | --- | --- | --- | --- |
| Security | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |
| Operations | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |
| Architecture | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |
| Product / owner | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |

## Rollback reference

- **Rollback document:** `...`
- **Rollback owner:** `...`
- **Rollback tested (UTC):** `YYYY-MM-DDTHH:MM:SSZ`
- **Rollback evidence link:** `...`

## Residual risks

- **Open risk:** `...`
- **Why it remains:** `...`
- **Mitigation in place:** `...`
- **Follow-up owner:** `...`
- **Review date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`

## Final notes

- Keep this record immutable once signoff is complete.
- If a blocker appears after signoff, append a dated addendum rather than rewriting the decision trail.
- Do not mark signoff as complete until both the machine validation chain and the AO/manual proof set are attached and reviewable.
