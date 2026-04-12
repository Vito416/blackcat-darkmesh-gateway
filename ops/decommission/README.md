# Decommission Package (Gateway)

This folder contains the retained migration/decommission evidence after retiring the legacy snapshot code.

## Current state

- Legacy runtime snapshots are removed from the repository.
- Runtime request path is gateway-owned (`src/runtime/**`, `src/clients/**`).
- `kernel-migration/` has been retired; all active evidence now lives under `ops/decommission/`.

## Keep these files current

- `BACKLOG.md` – release backlog and AO blocker tracking.
- `DECOMMISSION_CHECKLIST.md` – closeout criteria and evidence inventory.
- `FINAL_MIGRATION_SUMMARY.md` – canonical migration summary for release signoff.
- `SIGNOFF_RECORD.md` – final decision trail and approvals.
- `ao-dependency-gate.json` – machine-readable AO dependency gate used by release tooling.
- `LEGACY_INTEGRATION_AUDIT.md` – integration proof that legacy libs are replaced in gateway runtime.
- `TEMPLATE_BACKEND_GUARDRAILS.md` – template/backend trust boundary rules.

## Related artifacts

- Integrity schema: `security/contracts/integrity-snapshot-v1.schema.json`
- Legacy metadata-only archive notes: `ops/decommission/legacy-archive/`

## Purpose

This package remains as the operational evidence trail for releases and audits while keeping legacy source snapshots out of the codebase.
