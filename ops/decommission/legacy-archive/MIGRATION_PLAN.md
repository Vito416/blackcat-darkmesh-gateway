# Migration Plan (Closed)

Status: **closed** (legacy runtime snapshots retired)

## Outcome

All gateway request-path/runtime boundaries now use gateway-owned modules under `src/runtime/**` and `src/clients/**`.

Legacy source snapshots were removed after evidence checks passed:

- `npm run ops:check-legacy-runtime-boundary -- --strict --json`
- `npm run ops:check-legacy-no-import-evidence -- --strict --json`
- `npm run ops:check-legacy-core-extraction-evidence -- --strict --json`
- `npm run ops:check-legacy-crypto-boundary-evidence -- --strict --json`
- `npm test`

## Notes

- Installer remains `ops-only` by design (not a request-path runtime dependency).
- Historical path strings remain in boundary regex checks to fail fast on accidental reintroduction.
