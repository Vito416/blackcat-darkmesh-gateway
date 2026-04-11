# Legacy Snapshot -> Gateway Runtime Migration Plan

This plan is the working guide for moving code in `libs/legacy/` into gateway-owned runtime modules.

## Goal

Move legacy snapshots into the gateway in a way that is:

- auditable: every imported snapshot has a clear owner, destination, and exit criteria
- incremental: integration modules land before runtime extraction
- fail-closed: security-sensitive paths do not keep legacy fallback behavior
- decommissionable: each snapshot can be removed once the gateway-owned replacement is live

## Module matrix (status snapshot: `2026-04-11` UTC)

| Module | Role | Language | Gateway target path | Dependency risk | Security risk | Priority | Current status | Decommission condition (explicit, testable) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `blackcat-config` | Runtime config and profile loading | PHP | `src/runtime/config/` | High | High | P0 | `extracted` | Gateway-owned config/profile loader covers security-critical fetch settings (`src/runtime/config/loader.ts`, `src/runtime/config/profile.ts`) and is wired into request-path modules (`src/templateApi.ts`, `src/handler.ts`, `src/webhooks.ts`, `src/ratelimit.ts`, `src/replay.ts`); `tests/runtime-config-loader.test.ts` + `tests/runtime-config-profile.test.ts` + `tests/profile-tuning-sync.test.ts` pass, and `rg -n "libs/legacy/blackcat-config" src` returns no matches. |
| `blackcat-core` | Shared kernel primitives and low-level utilities | PHP | `src/runtime/core/` + `src/runtime/template/` | High | High | P0 | `in progress` | Core groundwork is present (`src/runtime/core/bytes.ts`, `src/runtime/core/json.ts`, `src/runtime/core/index.ts`, `src/runtime/template/actions.ts`, `src/runtime/template/validators.ts`), including the gateway-owned canonical JSON primitive and byte-limit-safe parsing helpers; the primitive-by-primitive map is now machine-readable in `kernel-migration/core-primitive-map.json` (`byte helpers`, `json parsing`, `canonical json`, `template helpers`), and decommission still requires the mapped tests (`tests/runtime-core-bytes.test.ts`, `tests/runtime-core-json.test.ts`, `tests/runtime-core-canonicalJson.test.ts`, `tests/template-api.test.ts`, `tests/validate-template-backend-contract.test.ts`) plus `rg -n "libs/legacy/blackcat-core" src` returning no matches. |
| `blackcat-crypto` | AEAD, HMAC, key rotation, envelope handling | PHP | `src/runtime/crypto/` | High | High | P0 | `partially extracted` | Request-path signature comparisons use `src/runtime/crypto/safeCompare.ts`, HMAC verification now uses `src/runtime/crypto/hmac.ts`, signature-ref validation lives in `src/runtime/crypto/signatureRefs.ts`, `tests/runtime-crypto-safeCompare.test.ts` + `tests/runtime-crypto-hmac.test.ts` + `tests/runtime-crypto-signatureRefs.test.ts` + `tests/webhooks.test.ts` pass, and `rg -n "libs/legacy/blackcat-crypto" src` returns no matches. |
| `blackcat-auth` | Authentication, authorization, token/session policy | PHP | `src/runtime/auth/` | High | High | P0 | `extracted` | Request auth checks use `src/runtime/auth/httpAuth.ts` + `src/runtime/auth/policy.ts`, `tests/runtime-auth-httpAuth.test.ts` + `tests/runtime-auth-policy.test.ts` + `tests/metrics-auth.test.ts` pass, and `rg -n "libs/legacy/blackcat-auth" src` returns no matches. |
| `blackcat-sessions` | DB-backed session lifecycle | PHP | `src/runtime/sessions/` | High | High | P0 | `extracted` | Replay/session guardrails run through `src/runtime/sessions/replayStore.ts` + `src/runtime/sessions/lifecycle.ts`, `tests/runtime-sessions-replayStore.test.ts` + `tests/runtime-sessions-lifecycle.test.ts` + `tests/rate-replay-limits.test.ts` pass, and `rg -n "libs/legacy/blackcat-sessions" src` returns no matches. |
| `blackcat-auth-js` | TypeScript/JavaScript auth SDK/client helpers | TypeScript / JavaScript | `src/clients/auth-sdk/` boundary | Medium | Medium | P1 | `extracted` | A committed gateway-owned auth client boundary exists (`src/clients/auth-sdk/client.ts`), boundary contract tests pass (`tests/clients-auth-sdk.test.ts`), and `rg -n "libs/legacy/blackcat-auth-js" src` returns no matches. |
| `blackcat-crypto-js` | TypeScript/JavaScript crypto SDK/client helpers | TypeScript / JavaScript | `src/clients/crypto-sdk/` boundary | Medium | Medium | P1 | `extracted` | A committed gateway-owned crypto client boundary exists (`src/clients/crypto-sdk/client.ts`), boundary contract tests pass (`tests/clients-crypto-sdk.test.ts`), and `rg -n "libs/legacy/blackcat-crypto-js" src` returns no matches. |
| `blackcat-mailing` | Outbox, SMTP transport, queue worker | PHP | `src/runtime/mailing/` | Medium | Medium | P1 | `extracted` | Gateway mailing ownership includes payload/sanitization plus queue+transport+delivery boundaries (`src/runtime/mailing/payloadPolicy.ts`, `src/runtime/mailing/sanitizer.ts`, `src/runtime/mailing/queue.ts`, `src/runtime/mailing/transport.ts`, `src/runtime/mailing/delivery.ts`), focused queue/transport + delivery-path tests pass, and `rg -n "libs/legacy/blackcat-mailing" src` returns no matches. |
| `blackcat-gopay` | Payment gateway integration and idempotent payment flow | PHP | `src/runtime/payments/` | Medium | High | P1 | `extracted` | Gateway payment boundary includes provider/validator helpers plus GoPay webhook verification and idempotency (`src/runtime/payments/providers.ts`, `src/runtime/payments/validators.ts`, `src/runtime/payments/gopayWebhook.ts`, `src/runtime/payments/webhookIdempotency.ts`, `/webhook/gopay` in `src/handler.ts`); decommission requires focused GoPay webhook/idempotency tests and `rg -n "libs/legacy/blackcat-gopay" src` returning no matches. |
| `blackcat-analytics` | Event/telemetry collection and reporting support | PHP | `src/runtime/telemetry/analytics/` | Medium | Low | P2 | `extracted` | Analytics event/policy normalization and sink retention/drop policy are gateway-owned (`src/runtime/telemetry/analyticsEvent.ts`, `src/runtime/telemetry/analyticsPolicy.ts`, `src/runtime/telemetry/sink.ts`), `tests/runtime-telemetry-analytics.test.ts` passes, and `rg -n "libs/legacy/blackcat-analytics" src` returns no matches. |
| `blackcat-installer` | Environment bootstrap and module installation workflow | PHP + shell helpers | `ops/bootstrap/` or docs-only (no request-path runtime target) | High | Low | P2 | `in progress` | Installer logic remains ops-only, boundary checks pass (`npm run ops:check-installer-runtime-boundary -- --strict`), `rg -n "blackcat-installer|libs/legacy/blackcat-installer" src` returns no matches, and operator docs point to gateway-owned scripts/runbooks under `ops/` + `scripts/`. |

Status meanings:

- `partially extracted`: gateway-owned runtime helpers are already in use, but module scope is not fully replaced.
- `in progress`: target boundary/path is being built and decommission checks still fail.
- `not started`: no gateway-owned replacement module is complete yet.

Global guardrail for all modules:

- `npm run ops:check-legacy-runtime-boundary -- --strict` must report `Findings: 0` before any module is marked fully decommissionable.

## Phased plan

### Phase 0: Inventory and audit

1. Enumerate every snapshot module, its current import sites, and the gateway feature it supports.
2. Classify each module as one of:
   - runtime dependency
   - integration-only dependency
   - client SDK/helper
   - do-not-port tooling
3. Record external systems, secrets, file paths, and implicit assumptions for each module.
4. Mark any unsafe patterns early so they are not copied into gateway-owned code.

Exit criteria:

- every module has a named owner, destination, priority, and decommission condition
- every gateway import from `libs/legacy/` has a planned replacement path
- all security-sensitive assumptions are written down before extraction starts

### Phase 1: Integration modules and facades

1. Add gateway-owned integration modules that preserve the current contract while hiding the snapshot implementation.
2. Keep legacy code behind a small surface area:
   - config loader integration module
   - crypto facade
   - auth/session facade
   - mailing transport wrapper
   - payment gateway wrapper
3. Translate legacy payloads and config shapes at the boundary, not inside runtime handlers.
4. Prefer thin shims that are easy to delete once the native gateway module is ready.

Exit criteria:

- gateway request paths call only gateway-owned integration modules
- no new direct imports from `libs/legacy/` are added outside the integration boundary
- integration module behavior is documented with the minimum contract needed for extraction

### Phase 2: Runtime extraction

1. Move audited code into gateway-owned runtime modules one boundary at a time.
2. Replace integration internals with native gateway implementations.
3. Keep the most security-sensitive modules first:
   - config
   - crypto
   - auth
   - sessions
4. Follow with operational modules:
   - mailing
   - payments
   - telemetry helpers
5. Retire any legacy-only helper once the gateway module matches the required behavior.

Exit criteria:

- runtime imports point at gateway-owned modules only
- request-path behavior is preserved or intentionally tightened
- security-sensitive code is fail-closed and no longer depends on legacy snapshots

### Phase 3: Decommission

1. Remove unused snapshot references from gateway runtime code.
2. Update docs, migration notes, and backlog items to point at the gateway-owned modules.
3. Archive or delete any snapshot that is no longer needed for audit history.
4. Verify there are no remaining runtime references to legacy module paths.

Exit criteria:

- `libs/legacy/` is reference-only, or fully removed where no longer required
- the gateway build and runtime paths do not require legacy snapshots
- decommission evidence is recorded for each retired module

## Do-not-port rules

Do not copy these into gateway runtime:

- vendor trees, `node_modules/`, build outputs, coverage reports, caches, and generated artifacts
- tests, fixtures, and template directories
- installer/bootstrap scripts that only support legacy repo layout
- compatibility shims that reintroduce hidden global state or mutable singletons
- raw SQL, ad-hoc query strings, or non-audited persistence shortcuts
- dynamic eval, reflection-based dispatch, unchecked deserialization, or other runtime code loading tricks
- direct secret reads from docroot or other unsafe filesystem locations
- silent fallback from verified crypto/auth/session state to plaintext, unauthenticated, or env-only bypass modes
- network calls that bypass gateway-owned integration modules or bypass policy/audit logging

Security rule of thumb:

- if a pattern weakens auditability, makes failures implicit, or widens the trust boundary, it stays out of the gateway runtime

## Working rule

Treat the legacy snapshot as the source for audit and parity only. The gateway runtime should absorb the cleaned contract, not the legacy structure.
