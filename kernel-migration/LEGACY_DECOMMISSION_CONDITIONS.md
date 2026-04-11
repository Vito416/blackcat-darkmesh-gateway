# Legacy Decommission Conditions

Updated (UTC): `2026-04-11`

This file defines the minimum removal gate for each `libs/legacy/<module>/` snapshot so weekly release review can mark modules as blocked vs removable.

## Common gate (all modules)

- [ ] Update `kernel-migration/LEGACY_MODULE_MAP.md` status (`pending`/`in progress`/`partially extracted` -> `extracted` -> `removed`) with date/PR reference.
- [ ] Update `libs/legacy/MANIFEST.md` in the same PR that removes a module directory.
- [ ] Archive command output for `npm run ops:validate-legacy-manifest -- --manifest libs/legacy/MANIFEST.md --legacy-dir libs/legacy --strict`.
- [ ] Archive command output for `npm test` from the same commit.
- [ ] Keep template runtime coverage green (`tests/template-api.test.ts`, `tests/validate-template-backend-contract.test.ts`) because template policy is already gateway-owned.

## Module-by-module conditions

### `blackcat-analytics` (current: `extracted`)
- Tests required: `tests/runtime-telemetry-analytics.test.ts` passes and covers event mapping, sink decisions, and telemetry emission paths.
- Docs required: record final destination (`src/runtime/telemetry/analytics/` or explicit do-not-port decision) in `libs/legacy/MIGRATION_PLAN.md` and the module map.
- Proof required: show no request-path dependency on `libs/legacy/blackcat-analytics`.
- Evidence to archive:
  - focused analytics test log
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

### `blackcat-auth-js` (current: `extracted`)
- Tests required: keep and expand client-boundary coverage (`tests/clients-auth-sdk.test.ts` or equivalent) for `src/clients/auth-sdk/client.ts` before any snapshot removal.
- Docs required: keep the gateway-owned client boundary and its current map + migration-plan status synchronized until the snapshot can be removed.
- Proof required: gateway request-path runtime remains independent from `libs/legacy/blackcat-auth-js`, and any boundary stays non-request-path.
- Evidence to archive:
  - client-boundary test log (`tests/clients-auth-sdk.test.ts`)
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

### `blackcat-core` (current: `in progress`)
- Tests required: keep current groundwork tests (`tests/runtime-core-bytes.test.ts`, `tests/template-api.test.ts`, `tests/validate-template-backend-contract.test.ts`) and add coverage for each additional primitive moved into `src/runtime/core/`.
- Docs required: complete primitive-by-primitive mapping in `libs/legacy/MIGRATION_PLAN.md` and record final target paths in `kernel-migration/LEGACY_MODULE_MAP.md`.
- Proof required: no hidden direct dependency on `libs/legacy/blackcat-core` in request path and no backslide from runtime-core boundaries to legacy helpers.
- Evidence to archive:
  - primitive replacement test log
  - `rg` no-import proof log
  - PR/commit link for core mapping completion

### `blackcat-crypto` (current: `partially extracted`)
- Tests required: `tests/runtime-crypto-safeCompare.test.ts` plus webhook verification coverage (`tests/webhooks.test.ts`) pass in removal PR.
- Docs required: map + migration plan row marked `removed` with replacement path `src/runtime/crypto/safeCompare.ts`.
- Proof required: no runtime imports from `libs/legacy/blackcat-crypto`.
- Evidence to archive:
  - focused test run log
  - `rg` no-import proof log
  - PR/commit link for crypto snapshot removal

### `blackcat-crypto-js` (current: `extracted`)
- Tests required: keep and expand compatibility/contract coverage (`tests/clients-crypto-sdk.test.ts` or equivalent) for `src/clients/crypto-sdk/client.ts` before any snapshot removal.
- Docs required: keep the gateway-owned client boundary and its current map + migration-plan status synchronized until the snapshot can be removed.
- Proof required: gateway runtime stays independent from `libs/legacy/blackcat-crypto-js`, and any boundary remains non-request-path.
- Evidence to archive:
  - client-boundary test log (`tests/clients-crypto-sdk.test.ts`)
  - `rg` runtime no-import proof log
  - PR/commit link for scope decision

### `blackcat-gopay` (current: `extracted`)
- Tests required: keep provider validation coverage (`tests/runtime-payments-validators.test.ts`), commit focused webhook route coverage (`tests/handler-gopay-webhook.test.ts`), and add idempotency adapter tests for duplicate event handling before any snapshot removal.
- Docs required: record final payment boundary including webhook verifier path (`src/runtime/payments/gopayWebhook.ts`) and the planned idempotency adapter under `src/runtime/payments/`.
- Proof required: do not remove snapshot until committed gateway-owned webhook + idempotency adapter boundaries exist and `rg -n "libs/legacy/blackcat-gopay" src` returns no matches.
- Evidence to archive:
  - payment/webhook test log
  - API contract or runbook link
  - PR/commit link for GoPay migration completion

### `blackcat-mailing` (current: `extracted`)
- Tests required: keep payload/sanitizer coverage (`tests/runtime-mailing-policy.test.ts`) and keep/expand focused queue+transport coverage (`tests/runtime-mailing-transport.test.ts`) before any snapshot removal.
- Docs required: document final ownership and runtime boundary (`src/runtime/mailing/queue.ts`, `src/runtime/mailing/transport.ts`) in migration docs, including whether delivery is gateway-owned or delegated.
- Proof required: if Worker-owned, prove no direct SMTP/runtime dependency on `libs/legacy/blackcat-mailing` in gateway; if gateway-owned, prove queue+transport path is committed and legacy-independent.
- Evidence to archive:
  - ownership test/integration log
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
- Tests required: add ops-only validation if any installer logic is retained under `ops/bootstrap/`.
- Docs required: explicit do-not-port/runtime exclusion decision and retained ops scope.
- Proof required: no request-path runtime dependency on `libs/legacy/blackcat-installer`.
- Evidence to archive:
  - ops validation log
  - `rg` no-import proof log
  - PR/commit link for installer decommission decision
