# Kernel Integrity Migration Package (Gateway)

This folder is the in-repo migration package for moving `blackcat-kernel-contracts`
integrity logic into the AO + Gateway architecture.

Goal:
- keep the security model,
- remove EVM-only dependencies from runtime decisions,
- make the stack compatible with constrained shared hosting environments (including WEDOS NoLimit),
- and prepare the project to safely retire `blackcat-kernel-contracts` as a separate repo.

Source snapshot:
- upstream repo: `blackcat-kernel-contracts`
- snapshot branch: `main`
- snapshot commit: `62a27ec643ff68bdfc43bc88a533d8be4a406f18`
- snapshot date: `2026-04-09`

## What is in this package

- `KERNEL_PORT_SCOPE.md`
  - detailed component-by-component mapping of what is migrated, what is adapted, and what is dropped.
- `AO_GATEWAY_DESIGN.md`
  - AO-native and Gateway-native integrity design, including runtime behavior on shared hosting.
- `BACKLOG.md`
  - detailed P0/P1/P2 implementation backlog and acceptance criteria.
- `DECOMMISSION_CHECKLIST.md`
  - strict checklist required before deleting/archiving `blackcat-kernel-contracts`.
- `upstream/`
  - temporary copied upstream docs kept here as migration references.

## Migration principles

1. Port security semantics, not Solidity syntax.
2. Keep deterministic checks in AO where possible.
3. Keep Gateway checks lightweight on request path; do heavy verification on publish/cache-fill/startup hooks.
4. Preserve authority separation (`root`, `upgrade`, `emergency`, `reporter`) with rotatable keys.
5. Keep clear incident and rollback paths.

## WEDOS NoLimit compatibility direction

For shared hosting constraints we treat the gateway runtime as:
- stateless request handling + short-lived local cache,
- optional file-based snapshots/checkpoints,
- no mandatory long-running private daemons for correctness,
- predictable CPU usage (no expensive full verification per request).

This package is intentionally detailed so implementation can continue without re-reading all old EVM materials.
