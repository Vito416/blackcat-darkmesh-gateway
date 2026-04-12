# Legacy Modules Snapshot (Gateway Consolidation)

This folder contains selected source snapshots imported from legacy Blackcat repositories to support consolidation into `blackcat-darkmesh-gateway`.

## Why this exists

- We are reducing repository sprawl and moving toward a smaller active set:
  - `blackcat-darkmesh-ao`
  - `blackcat-darkmesh-write`
  - `blackcat-darkmesh-web`
  - `blackcat-darkmesh-gateway`
  - `blackcat-templates` (kept as dedicated open template-development repo)
- Gateway is becoming the controlled backend surface for template runtime calls.
- Keeping snapshots here prevents rework and helps retire old repos safely.

Migration is driven by `MIGRATION_PLAN.md`, which keeps the snapshot inventory, phase gates, and do-not-port rules in one place.

## Included modules

- `blackcat-analytics`
- `blackcat-auth`
- `blackcat-auth-js`
- `blackcat-config`
- `blackcat-core`
- `blackcat-crypto`
- `blackcat-crypto-js`
- `blackcat-gopay`
- `blackcat-mailing`
- `blackcat-sessions`
- `blackcat-installer`

## Migration workflow

Use this sequence for every module:

1. snapshot - keep `kernel-migration/legacy-archive/snapshots/<module>/` as the read-only source reference
2. audit - record role, language, destination, dependency risk, and security risk in `MIGRATION_PLAN.md`
3. integration module - add a gateway-owned integration boundary that preserves the current contract
4. runtime module - move the cleaned implementation into the gateway runtime and remove the legacy import path

When a module still exists in `kernel-migration/legacy-archive/snapshots/`, treat it as reference material only. New runtime code should depend on gateway-owned modules, not on the snapshot directly.

## Intentionally excluded from import

- `vendor/`, `node_modules/`, build outputs, and caches
- test trees (`tests/`, `test/`)
- `templates/` directories

Template assets are intentionally excluded because `blackcat-templates` remains the dedicated template repository.

## Import command

Run from `blackcat-darkmesh-gateway`:

```bash
bash scripts/import-legacy-libs.sh
```

## Notes

- These snapshots are migration references and source donors, not immediately production-ready drop-ins.
- Final consolidation should move cleaned modules into gateway-owned runtime modules with proper API boundaries and a documented decommission path.
- See `MIGRATION_PLAN.md` for the per-module table, phase gates, and do-not-port rules.
