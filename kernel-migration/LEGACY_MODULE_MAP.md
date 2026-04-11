# Legacy Module Map

Updated (UTC): `2026-04-11`

Use this table in weekly release review to track consolidation progress for every module listed in `libs/legacy/MANIFEST.md`.

Status legend:
- `extracted`: gateway-owned runtime path exists and is covered by tests.
- `partially extracted`: gateway-owned helper/runtime slices exist, but full module scope is not replaced yet.
- `pending`: target path is planned, but extraction/decommission conditions are not yet complete.
- `pending (do-not-port candidate)`: likely to remain tooling/integration-only until scope is explicitly approved.

Out-of-manifest context:
- Template runtime policy is already gateway-owned in `src/runtime/template/` + `src/templateApi.ts`.
- Source guardrails come from `libs/legacy/TEMPLATE_BACKEND_GUARDRAILS.md` and `blackcat-templates` (not from a `MANIFEST.md` module row).

| module | source commit | gateway target path | current status | owner/workstream | notes |
| --- | --- | --- | --- | --- | --- |
| `blackcat-analytics` | `9f69f1d` | `src/runtime/telemetry/analyticsEvent.ts`, `src/runtime/telemetry/analyticsPolicy.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P2` | Analytics normalization/policy helpers exist with coverage in `tests/runtime-telemetry-analytics.test.ts`; sink/export integration still pending. |
| `blackcat-auth` | `14534b4` | `src/runtime/auth/httpAuth.ts` | `extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Used by `src/handler.ts`; covered by `tests/runtime-auth-httpAuth.test.ts`. |
| `blackcat-auth-js` | `ff46aa7` | `src/clients/auth-sdk/` (planned) | `pending` | `TODO(owner)` / `gateway-libs-consolidation:P1` | No committed `src/clients/` boundary yet; keep snapshot as reference. |
| `blackcat-config` | `aea90d4` | `src/runtime/config/profile.ts` | `extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Used by `src/integrity/fetch-control.ts`; covered by `tests/runtime-config-profile.test.ts`. |
| `blackcat-core` | `f1c3dc7` | `src/runtime/core/` (planned), `src/runtime/template/` (current helper extraction) | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Template policy/validation helpers are gateway-owned; broad kernel primitive mapping is still open. |
| `blackcat-crypto` | `4f59c09` | `src/runtime/crypto/safeCompare.ts` | `extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Used by `src/webhooks.ts`; covered by `tests/runtime-crypto-safeCompare.test.ts` and webhook tests. |
| `blackcat-crypto-js` | `8df11f5` | `src/clients/crypto-sdk/` (planned) | `pending` | `TODO(owner)` / `gateway-libs-consolidation:P1` | No committed crypto SDK client boundary in gateway yet. |
| `blackcat-gopay` | `1b75a60` | `src/runtime/payments/providers.ts`, `src/runtime/payments/validators.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P1` | Provider/validation boundary exists with tests; full callback/idempotency adapter and route integration remain pending. |
| `blackcat-mailing` | `2e28e28` | `src/runtime/mailing/payloadPolicy.ts`, `src/runtime/mailing/sanitizer.ts` | `partially extracted` | `TODO(owner)` / `gateway-libs-consolidation:P1` | Payload and sanitization helpers exist with tests; queue/transport ownership integration remains pending. |
| `blackcat-sessions` | `5977072` | `src/runtime/sessions/replayStore.ts` | `extracted` | `TODO(owner)` / `gateway-libs-consolidation:P0` | Used by `src/replay.ts`; covered by `tests/runtime-sessions-replayStore.test.ts`. |
| `blackcat-installer` | `a975d15` | `ops/bootstrap/` (planned) | `pending (do-not-port candidate)` | `TODO(owner)` / `gateway-libs-consolidation:P2` | No `ops/bootstrap/` integration exists; treat as tooling-only until explicitly approved. |

Rollup:
- Extracted from `MANIFEST.md` modules: `4/11` (`auth`, `config`, `crypto`, `sessions`).
- Partially extracted from `MANIFEST.md` modules: `4/11` (`core`, `mailing`, `gopay`, `analytics`).
- Pending from `MANIFEST.md` modules: `3/11` (`auth-js`, `crypto-js`, `installer`).
