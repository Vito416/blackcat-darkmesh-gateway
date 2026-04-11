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
| `blackcat-analytics` | `9f69f1d` | `src/runtime/telemetry/analyticsEvent.ts`, `src/runtime/telemetry/analyticsPolicy.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P2` | Analytics normalization/policy helpers exist with coverage in `tests/runtime-telemetry-analytics.test.ts`; sink/export integration is still pending. |
| `blackcat-auth` | `14534b4` | `src/runtime/auth/httpAuth.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Request-path auth helpers are in use via `src/handler.ts` and covered by `tests/runtime-auth-httpAuth.test.ts`; broader auth policy surface is still open. |
| `blackcat-auth-js` | `ff46aa7` | `src/clients/auth-sdk/client.ts` | `in progress` | `TODO(owner)` / `gateway-libs-consolidation:P1` | Client boundary exists with focused tests (`tests/clients-auth-sdk.test.ts`), but ownership sign-off and extended contract coverage are still pending. |
| `blackcat-config` | `aea90d4` | `src/runtime/config/profile.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Profile tuning helper is used by `src/integrity/fetch-control.ts` and covered by `tests/runtime-config-profile.test.ts`; full config secret-source contract extraction is still open. |
| `blackcat-core` | `f1c3dc7` | `src/runtime/core/` + `src/runtime/template/` | `in progress` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Core groundwork exists (`src/runtime/core/bytes.ts`, `tests/runtime-core-bytes.test.ts`) plus template helper extraction; primitive-by-primitive mapping is still open. |
| `blackcat-crypto` | `4f59c09` | `src/runtime/crypto/safeCompare.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Signature comparison helper is used by webhook verification and covered by `tests/runtime-crypto-safeCompare.test.ts`; broader crypto boundary extraction is still pending. |
| `blackcat-crypto-js` | `8df11f5` | `src/clients/crypto-sdk/client.ts` | `in progress` | `TODO(owner)` / `gateway-libs-consolidation:P1` | Client boundary exists with focused tests (`tests/clients-crypto-sdk.test.ts`), but ownership sign-off and extended contract coverage are still pending. |
| `blackcat-gopay` | `1b75a60` | `src/runtime/payments/providers.ts`, `src/runtime/payments/validators.ts`, `src/runtime/payments/gopayWebhook.ts` | `in progress` | `TODO(owner)` / `gateway-libs-consolidation:P1` | GoPay webhook groundwork exists (`/webhook/gopay` in `src/handler.ts`, `tests/handler-gopay-webhook.test.ts`), but explicit idempotency adapter extraction and duplicate-write tests remain open. |
| `blackcat-mailing` | `2e28e28` | `src/runtime/mailing/payloadPolicy.ts`, `src/runtime/mailing/sanitizer.ts`, `src/runtime/mailing/queue.ts`, `src/runtime/mailing/transport.ts` | `in progress` | `TODO(owner)` / `gateway-libs-consolidation:P1` | Queue/transport groundwork is present; focused queue/transport tests and final ownership wiring are still pending. |
| `blackcat-sessions` | `5977072` | `src/runtime/sessions/replayStore.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Replay-store helper is used by `src/replay.ts` and covered by `tests/runtime-sessions-replayStore.test.ts`; full session lifecycle extraction is still open. |
| `blackcat-installer` | `a975d15` | `ops/bootstrap/` (planned) | `pending (do-not-port candidate)` | `TODO(owner)` / `gateway-libs-consolidation:P2` | No `ops/bootstrap/` integration exists; treat as tooling-only until explicitly approved. |

Rollup:
- Extracted from `MANIFEST.md` modules: `0/11`.
- Partially extracted from `MANIFEST.md` modules: `5/11` (`analytics`, `auth`, `config`, `crypto`, `sessions`).
- In progress from `MANIFEST.md` modules: `5/11` (`core`, `auth-js`, `crypto-js`, `mailing`, `gopay`).
- Pending from `MANIFEST.md` modules: `1/11` (`installer`).
