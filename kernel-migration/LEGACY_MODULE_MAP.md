# Legacy Module Map

Updated (UTC): `2026-04-11`

Use this table in weekly release review to track consolidation progress for every module listed in `libs/legacy/MANIFEST.md`.

Status legend:
- `extracted`: gateway-owned replacement boundary is complete and ready for removal evidence.
- `partially extracted`: gateway-owned helper/runtime slices exist, but full module scope is not replaced yet.
- `in progress`: extraction boundary is being built now (including working-tree stubs that still need merge hardening).
- `pending`: target path is planned, but extraction/decommission conditions are not yet complete.
- `pending (do-not-port candidate)`: likely to remain tooling/integration-only until scope is explicitly approved.

Out-of-manifest context:
- Template runtime policy is already gateway-owned in `src/runtime/template/` + `src/templateApi.ts`.
- Runtime core groundwork exists under `src/runtime/core/bytes.ts` and is already consumed by `src/templateApi.ts`.
- Source guardrails come from `libs/legacy/TEMPLATE_BACKEND_GUARDRAILS.md` and `blackcat-templates` (not from a `MANIFEST.md` module row).

| module | source commit | gateway target path | current status | owner/workstream | notes |
| --- | --- | --- | --- | --- | --- |
| `blackcat-analytics` | `9f69f1d` | `src/runtime/telemetry/analyticsEvent.ts`, `src/runtime/telemetry/analyticsPolicy.ts` | `extracted` | `gateway-libs-consolidation:P2` | Analytics normalization/policy helpers and sink retention/drop policy are implemented in gateway-owned runtime code with coverage in `tests/runtime-telemetry-analytics.test.ts`; the remaining open item is removal evidence. |
| `blackcat-auth` | `14534b4` | `src/runtime/auth/httpAuth.ts` | `extracted` | `gateway-libs-consolidation:P0` | Request-path auth helpers are in use via `src/handler.ts` and covered by `tests/runtime-auth-httpAuth.test.ts`; shared role/signature-ref policy helpers live in `src/runtime/auth/policy.ts`, and the remaining open item is removal evidence. |
| `blackcat-auth-js` | `ff46aa7` | `src/clients/auth-sdk/client.ts` | `extracted` | `gateway-libs-consolidation:P1` | Client boundary exists with focused tests (`tests/clients-auth-sdk.test.ts`); ownership docs and removal evidence still need to be finalized before the snapshot is removed. |
| `blackcat-config` | `aea90d4` | `src/runtime/config/profile.ts` | `extracted` | `gateway-libs-consolidation:P0` | Profile tuning helper is used by `src/integrity/fetch-control.ts` and covered by `tests/runtime-config-profile.test.ts`; the loader/profile replacement is already wired into request-path code, and the remaining open item is removal evidence. |
| `blackcat-core` | `f1c3dc7` | `src/runtime/core/` + `src/runtime/template/` | `extracted` | `gateway-libs-consolidation:P0` | Core helpers are now gateway-owned across byte helpers, JSON parsing, canonical JSON, hash primitives, and template helpers (`src/runtime/template/secretGuard.ts` included); `kernel-migration/core-primitive-map.json` + `npm run ops:check-legacy-core-extraction-evidence -- --strict --json` are machine evidence, and the remaining open item is snapshot removal evidence. |
| `blackcat-crypto` | `4f59c09` | `src/runtime/crypto/safeCompare.ts` | `extracted` | `gateway-libs-consolidation:P0` | Signature comparison, HMAC verification, signature-ref validation, and verification-only boundary checks are gateway-owned (`src/runtime/crypto/safeCompare.ts`, `src/runtime/crypto/hmac.ts`, `src/runtime/crypto/signatureRefs.ts`, `src/runtime/crypto/boundary.ts`) with coverage in `tests/runtime-crypto-safeCompare.test.ts` + `tests/runtime-crypto-hmac.test.ts` + `tests/runtime-crypto-signatureRefs.test.ts` + `tests/runtime-crypto-boundary.test.ts` + `tests/webhooks.test.ts`; machine evidence is now emitted by `npm run ops:check-legacy-crypto-boundary-evidence -- --strict --json`, and the remaining open item is snapshot removal evidence. |
| `blackcat-crypto-js` | `8df11f5` | `src/clients/crypto-sdk/client.ts` | `extracted` | `gateway-libs-consolidation:P1` | Client boundary exists with focused tests (`tests/clients-crypto-sdk.test.ts`); ownership docs and removal evidence still need to be finalized before the snapshot is removed. |
| `blackcat-gopay` | `1b75a60` | `src/runtime/payments/providers.ts`, `src/runtime/payments/validators.ts`, `src/runtime/payments/gopayWebhook.ts` | `extracted` | `gateway-libs-consolidation:P1` | GoPay webhook verification and idempotency are implemented in gateway-owned runtime code (`src/runtime/payments/webhookIdempotency.ts`, `/webhook/gopay` in `src/handler.ts`, `tests/handler-gopay-webhook.test.ts`); the remaining open item is removal evidence. |
| `blackcat-mailing` | `2e28e28` | `src/runtime/mailing/payloadPolicy.ts`, `src/runtime/mailing/sanitizer.ts`, `src/runtime/mailing/queue.ts`, `src/runtime/mailing/transport.ts` | `extracted` | `gateway-libs-consolidation:P1` | Queue/transport/delivery groundwork is present and covered by `tests/runtime-mailing-transport.test.ts` and `tests/runtime-mailing-delivery.test.ts`; the remaining open item is the gateway-owned vs worker-owned dispatch decision. |
| `blackcat-sessions` | `5977072` | `src/runtime/sessions/replayStore.ts` | `extracted` | `gateway-libs-consolidation:P0` | Replay-store helper is used by `src/replay.ts` and covered by `tests/runtime-sessions-replayStore.test.ts`; session lifecycle helpers are also present in `src/runtime/sessions/lifecycle.ts`, and the remaining open item is removal evidence. |
| `blackcat-installer` | `a975d15` | `ops/bootstrap/` (planned) | `pending (do-not-port candidate)` | `gateway-libs-consolidation:P2` | No `ops/bootstrap/` integration exists; treat as tooling-only until explicitly approved, and keep the runtime boundary check green (`npm run ops:check-installer-runtime-boundary -- --strict`). |

Rollup:
- Extracted from `MANIFEST.md` modules: `10/11` (`analytics`, `auth`, `auth-js`, `config`, `core`, `crypto`, `crypto-js`, `gopay`, `mailing`, `sessions`).
- Partially extracted from `MANIFEST.md` modules: `0/11`.
- Pending from `MANIFEST.md` modules: `1/11` (`installer`, do-not-port candidate).
