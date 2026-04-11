# Legacy Decommission Conditions

Updated (UTC): `2026-04-11`

This file defines the minimum removal gate for each `libs/legacy/<module>/` snapshot so weekly release review can mark modules as blocked vs removable.

## Common gate (all modules)

- [ ] Update `kernel-migration/LEGACY_MODULE_MAP.md` status (`pending` -> `extracted` -> `removed`) with date/PR reference.
- [ ] Update `libs/legacy/MANIFEST.md` in the same PR that removes a module directory.
- [ ] Archive command output for `npm run ops:validate-legacy-manifest -- --manifest libs/legacy/MANIFEST.md --legacy-dir libs/legacy --strict`.
- [ ] Archive command output for `npm test` from the same commit.
- [ ] Keep template runtime coverage green (`tests/template-api.test.ts`, `tests/validate-template-backend-contract.test.ts`) because template policy is already gateway-owned.

## Module-by-module conditions

### `blackcat-analytics` (current: `partially extracted`)
- Tests required: `TODO(test)` add gateway-native analytics coverage for event mapping/telemetry emission.
- Docs required: record final destination (`src/runtime/telemetry/analytics/` or explicit do-not-port decision) in `libs/legacy/MIGRATION_PLAN.md` and the module map.
- Proof required: show no request-path dependency on `libs/legacy/blackcat-analytics`.
- Evidence to archive:
  - focused analytics test log (`TODO` until tests exist)
  - `rg` no-import proof log
  - PR/commit link for destination decision

### `blackcat-auth` (current: `extracted`)
- Tests required: `tests/runtime-auth-httpAuth.test.ts` and auth-gated endpoint coverage (`tests/metrics-auth.test.ts`) pass in removal PR.
- Docs required: map + migration plan row marked `removed` with replacement path `src/runtime/auth/httpAuth.ts`.
- Proof required: no runtime imports from `libs/legacy/blackcat-auth`.
- Evidence to archive:
  - focused test run log
  - `rg` no-import proof log
  - PR/commit link for auth snapshot removal

### `blackcat-auth-js` (current: `pending`)
- Tests required: `TODO(test)` add client-boundary tests if `src/clients/auth-sdk/` is introduced.
- Docs required: define whether this snapshot becomes gateway client boundary or stays out of runtime scope.
- Proof required: gateway request-path runtime remains independent from `libs/legacy/blackcat-auth-js`.
- Evidence to archive:
  - client-boundary test log (`TODO` until boundary exists)
  - `rg` runtime no-import proof log
  - PR/commit link for scope decision

### `blackcat-config` (current: `extracted`)
- Tests required: `tests/runtime-config-profile.test.ts` and `tests/profile-tuning-sync.test.ts` pass in removal PR.
- Docs required: map + migration plan row marked `removed` with replacement path `src/runtime/config/profile.ts`.
- Proof required: no runtime imports from `libs/legacy/blackcat-config`.
- Evidence to archive:
  - focused test run log
  - `rg` no-import proof log
  - PR/commit link for config snapshot removal

### `blackcat-core` (current: `partially extracted`)
- Tests required: `TODO(test)` add coverage for each primitive moved into gateway-owned `src/runtime/core/` (or equivalent explicit replacements).
- Docs required: complete primitive-by-primitive mapping in `libs/legacy/MIGRATION_PLAN.md` and map final target paths.
- Proof required: no hidden direct dependency on `libs/legacy/blackcat-core` in request path.
- Evidence to archive:
  - primitive replacement test log (`TODO` until replacements land)
  - `rg` no-import proof log
  - PR/commit link for core mapping completion

### `blackcat-crypto` (current: `extracted`)
- Tests required: `tests/runtime-crypto-safeCompare.test.ts` plus webhook verification coverage (`tests/webhooks.test.ts`) pass in removal PR.
- Docs required: map + migration plan row marked `removed` with replacement path `src/runtime/crypto/safeCompare.ts`.
- Proof required: no runtime imports from `libs/legacy/blackcat-crypto`.
- Evidence to archive:
  - focused test run log
  - `rg` no-import proof log
  - PR/commit link for crypto snapshot removal

### `blackcat-crypto-js` (current: `pending`)
- Tests required: `TODO(test)` add compatibility tests if a gateway client crypto boundary is introduced.
- Docs required: define retained scope (`src/clients/crypto-sdk/` vs do-not-port) and record it in map + migration plan.
- Proof required: gateway runtime stays independent from `libs/legacy/blackcat-crypto-js`.
- Evidence to archive:
  - client-boundary test log (`TODO` until boundary exists)
  - `rg` runtime no-import proof log
  - PR/commit link for scope decision

### `blackcat-gopay` (current: `partially extracted`)
- Tests required: `TODO(test)` add GoPay payment + callback/idempotency coverage before any snapshot removal.
- Docs required: record final gateway payment boundary (`src/runtime/payments/`) and webhook/API contract.
- Proof required: do not remove snapshot until a committed gateway-owned payment adapter exists.
- Evidence to archive:
  - payment/webhook test log (`TODO` until adapter exists)
  - API contract or runbook link
  - PR/commit link for GoPay migration completion

### `blackcat-mailing` (current: `partially extracted`)
- Tests required: `TODO(test)` prove mailing path ownership (gateway runtime module or explicit Worker-only delegation).
- Docs required: document final ownership in README + migration plan (gateway vs worker).
- Proof required: if Worker-owned, prove no direct SMTP/runtime dependency on `libs/legacy/blackcat-mailing` in gateway.
- Evidence to archive:
  - ownership test/integration log (`TODO` until finalized)
  - `rg` no-import proof log
  - PR/commit link for ownership decision

### `blackcat-sessions` (current: `extracted`)
- Tests required: `tests/runtime-sessions-replayStore.test.ts` and replay limit behavior (`tests/rate-replay-limits.test.ts`) pass in removal PR.
- Docs required: map + migration plan row marked `removed` with replacement path `src/runtime/sessions/replayStore.ts`.
- Proof required: no runtime imports from `libs/legacy/blackcat-sessions`.
- Evidence to archive:
  - focused test run log
  - `rg` no-import proof log
  - PR/commit link for sessions snapshot removal

### `blackcat-installer` (current: `pending`)
- Tests required: `TODO(test)` add ops-only validation if any installer logic is retained under `ops/bootstrap/`.
- Docs required: explicit do-not-port/runtime exclusion decision and retained ops scope.
- Proof required: no request-path runtime dependency on `libs/legacy/blackcat-installer`.
- Evidence to archive:
  - ops validation log (`TODO` until retained scope exists)
  - `rg` no-import proof log
  - PR/commit link for installer decommission decision
