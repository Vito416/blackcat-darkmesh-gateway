# Legacy Integration Audit

Updated (UTC): `2026-04-12T17:28:37Z`

## Scope

This audit confirms `blackcat-kernel-contracts` and all legacy module responsibilities are now covered by gateway-owned code, and that runtime request paths do not depend on legacy sources.

## Runtime boundary + integration proof

Commands executed:

```bash
npm run ops:check-legacy-runtime-boundary -- --strict --json
npm run ops:check-legacy-core-extraction-evidence -- --strict --json
npm run ops:check-legacy-crypto-boundary-evidence -- --strict --json
npm run ops:check-config-loader-runtime-boundary -- --strict
npm run ops:check-mailing-secret-boundary -- --strict
npm run ops:check-installer-runtime-boundary -- --strict
npm run ops:check-legacy-no-import-evidence -- --strict --json
npm test
```

Result summary:

- `check-legacy-runtime-boundary`: `findingCount = 0`
- `check-legacy-no-import-evidence`: `findingCount = 0` (built-in legacy module set)
- `check-legacy-core-extraction-evidence`: pass
- `check-legacy-crypto-boundary-evidence`: pass (`verification-only`, no local signing path)
- Config/mailing/installer boundary checks: pass
- Full suite: `99` files, `599` tests, all passed

## Module integration matrix

| Legacy module | Gateway-owned replacement | Verification status |
| --- | --- | --- |
| `blackcat-core` | `src/runtime/core/**`, `src/runtime/template/**` | Integrated + covered by core/template tests and extraction boundary checks |
| `blackcat-crypto` | `src/runtime/crypto/**`, `src/webhooks.ts` | Integrated + covered by crypto/webhook tests and crypto boundary check |
| `blackcat-auth` | `src/runtime/auth/**` | Integrated + covered by auth policy/http auth tests |
| `blackcat-config` | `src/runtime/config/**` | Integrated + covered by loader/profile/boundary tests |
| `blackcat-sessions` | `src/runtime/sessions/**` | Integrated + covered by lifecycle/replay tests |
| `blackcat-mailing` | `src/runtime/mailing/**` | Integrated + covered by policy/transport/delivery/integration tests |
| `blackcat-gopay` | `src/runtime/payments/**` + webhook handler | Integrated + covered by payment validator + webhook tests |
| `blackcat-analytics` | `src/runtime/telemetry/**` | Integrated + covered by telemetry analytics tests |
| `blackcat-auth-js` | `src/clients/auth-sdk/**` | Integrated + covered by auth SDK client tests |
| `blackcat-crypto-js` | `src/clients/crypto-sdk/**` | Integrated + covered by crypto SDK client tests |
| `blackcat-installer` | No request-path port (ops-only classification) | Runtime boundary check enforces no request-path usage |

## Decommission state

- Legacy runtime snapshots are removed from the repository.
- `kernel-migration/` is retired; active evidence now lives in `ops/decommission/`.
- Runtime boundary scripts now track only the active legacy import root (`libs/legacy/**`), with old `kernel-migration` import roots removed.
- `security/crypto-policy/` has been normalized as a gateway-owned policy bundle (snapshot metadata removed, legacy context names removed).
- Remaining blockers are release closeout blockers (AO gate + drill artifacts), not legacy integration blockers.
