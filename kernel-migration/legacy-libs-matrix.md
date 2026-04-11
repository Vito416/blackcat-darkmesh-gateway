# Legacy Migration Matrix

- Generated at (UTC): `2026-04-11T21:02:17.888Z`
- Manifest: `libs/legacy/MANIFEST.md`
- Risk JSON: not provided
- Core primitive map: `kernel-migration/core-primitive-map.json`
- Module count: 11

## Modules

| Module | Source commit | Risk summary |
| --- | --- | --- |
| `blackcat-analytics` | `9f69f1d` | pending |
| `blackcat-auth` | `14534b4` | pending |
| `blackcat-auth-js` | `ff46aa7` | pending |
| `blackcat-config` | `aea90d4` | pending |
| `blackcat-core` | `f1c3dc7` | 5 primitive groups, 6 tests |
| `blackcat-crypto` | `4f59c09` | partially extracted |
| `blackcat-crypto-js` | `8df11f5` | pending |
| `blackcat-gopay` | `1b75a60` | pending |
| `blackcat-mailing` | `2e28e28` | pending |
| `blackcat-sessions` | `5977072` | pending |
| `blackcat-installer` | `a975d15` | pending (do-not-port candidate) |

## Risk summary

- Risk JSON was not provided; per-module risk summaries remain pending.

## Core primitive evidence

- Module: `blackcat-core`
- Source commit: `f1c3dc7`
- Request-path proof: `rg -n "libs/legacy/blackcat-core" src`
- Primitive groups: 5
- Test count: 6

| Primitive group | Legacy symbols | Gateway paths | Tests | Status |
| --- | --- | --- | --- | --- |
| byte helpers | `readPositiveInteger`<br>`utf8ByteLength`<br>`bodyExceedsUtf8Limit` | `src/runtime/core/bytes.ts` | `tests/runtime-core-bytes.test.ts` | mapped |
| json parsing | `parseJsonObject`<br>`parseJsonArray`<br>`parseJsonObjectBody`<br>`parseJsonArrayBody` | `src/runtime/core/json.ts` | `tests/runtime-core-json.test.ts` | mapped |
| canonical json | `canonicalizeJson` | `src/runtime/core/canonicalJson.ts` | `tests/runtime-core-canonicalJson.test.ts` | mapped |
| hash primitives | `sha256Hex`<br>`sha256Utf8`<br>`hashJsonCanonical` | `src/runtime/core/hash.ts` | `tests/runtime-core-hash.test.ts` | mapped |
| template helpers | `template action guards`<br>`template backend validation` | `src/runtime/template/actions.ts`<br>`src/runtime/template/validators.ts` | `tests/template-api.test.ts`<br>`tests/validate-template-backend-contract.test.ts` | mapped |

## Notes

- The risk summary column is a placeholder until audit-legacy-risk findings are mapped into module-level review notes.
- The core primitive evidence section is machine-readable and mirrors the gateway-owned runtime/core and runtime/template boundaries.
