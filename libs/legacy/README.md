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
- Final consolidation should move cleaned modules into `src/` or `libs/runtime/` with proper tests and API boundaries.
