# Legacy Snapshot -> Gateway Runtime Migration Plan

This plan is the working guide for moving code in `libs/legacy/` into gateway-owned runtime modules.

## Goal

Move legacy snapshots into the gateway in a way that is:

- auditable: every imported snapshot has a clear owner, destination, and exit criteria
- incremental: adapters land before runtime extraction
- fail-closed: security-sensitive paths do not keep legacy fallback behavior
- decommissionable: each snapshot can be removed once the gateway-owned replacement is live

## Module matrix

| Module | Role | Language | Likely destination in gateway | Dependency risk | Security risk | Priority | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `blackcat-config` | Runtime config and profile loading | PHP | `src/runtime/config/` | High | High | P0 | Gateway boots from gateway-owned config loader; no security-critical path depends on env-only bypasses; profile and secret resolution are covered by the gateway contract. |
| `blackcat-core` | Shared kernel primitives and low-level utilities | PHP | `src/runtime/core/` with narrow shared helpers only | High | High | P0 | Request-path code no longer imports legacy kernel primitives directly; any reused primitive has a gateway-owned wrapper or replacement; no hidden global state is introduced. |
| `blackcat-crypto` | AEAD, HMAC, key rotation, envelope handling | PHP | `src/runtime/crypto/` | High | High | P0 | All crypto and signing calls go through a gateway-owned facade; raw key handling is removed from callers; fail-closed verification is enforced before serving protected data. |
| `blackcat-auth` | Authentication, authorization, token/session policy | PHP | `src/runtime/auth/` | High | High | P0 | Login, token, and policy decisions are gateway-owned; session and role checks no longer rely on legacy imports; auth failures remain deterministic and auditable. |
| `blackcat-sessions` | DB-backed session lifecycle | PHP | `src/runtime/sessions/` | High | High | P0 | Session create/read/rotate/revoke flow uses gateway-owned storage and policy; no legacy shim is required in request handlers; invalid or stale sessions fail closed. |
| `blackcat-auth-js` | TypeScript/JavaScript auth SDK/client helpers | TypeScript / JavaScript | `src/clients/auth-sdk/` or an adapter boundary, not hot-path runtime | Medium | Medium | P1 | Gateway runtime does not depend on the snapshot at runtime; any client helper is isolated behind a documented interface and can be versioned independently. |
| `blackcat-crypto-js` | TypeScript/JavaScript crypto SDK/client helpers | TypeScript / JavaScript | `src/clients/crypto-sdk/` or an adapter boundary, not hot-path runtime | Medium | Medium | P1 | Gateway runtime no longer imports the snapshot directly; envelope and slot helpers are either gateway-owned or kept strictly as client-side support code. |
| `blackcat-mailing` | Outbox, SMTP transport, queue worker | PHP | `src/runtime/mailing/` | Medium | Medium | P1 | Queue enqueue and SMTP dispatch are gateway-owned; mail payload handling stays behind a single adapter; secrets and SMTP config are not read from ad-hoc legacy paths. |
| `blackcat-gopay` | Payment adapter and idempotent gateway integration | PHP | `src/runtime/payments/` | Medium | High | P1 | Payment creation, callback handling, and idempotency are gateway-owned; any external gateway client is isolated behind a single payment interface; duplicate writes are blocked. |
| `blackcat-analytics` | Event/telemetry collection and reporting support | PHP | `src/runtime/telemetry/analytics/` | Medium | Low | P2 | Gateway emits telemetry through its own sink; analytics consumers no longer require the legacy snapshot; event formatting is stable and documented. |
| `blackcat-installer` | Environment bootstrap and module installation workflow | PHP + shell helpers | `ops/bootstrap/` or docs-only; do not place in request-path runtime | High | Low | P2 | Installer behavior is excluded from runtime code; any retained logic stays in ops/tooling space only; no runtime import depends on installer commands or templates. |

## Phased plan

### Phase 0: Inventory and audit

1. Enumerate every snapshot module, its current import sites, and the gateway feature it supports.
2. Classify each module as one of:
   - runtime dependency
   - adapter-only dependency
   - client SDK/helper
   - do-not-port tooling
3. Record external systems, secrets, file paths, and implicit assumptions for each module.
4. Mark any unsafe patterns early so they are not copied into gateway-owned code.

Exit criteria:

- every module has a named owner, destination, priority, and decommission condition
- every gateway import from `libs/legacy/` has a planned replacement path
- all security-sensitive assumptions are written down before extraction starts

### Phase 1: Adapters and facades

1. Add gateway-owned adapters that preserve the current contract while hiding the snapshot implementation.
2. Keep legacy code behind a small surface area:
   - config loader adapter
   - crypto facade
   - auth/session facade
   - mailing transport wrapper
   - payment gateway wrapper
3. Translate legacy payloads and config shapes at the boundary, not inside runtime handlers.
4. Prefer thin shims that are easy to delete once the native gateway module is ready.

Exit criteria:

- gateway request paths call only gateway-owned adapters
- no new direct imports from `libs/legacy/` are added outside the adapter boundary
- adapter behavior is documented with the minimum contract needed for extraction

### Phase 2: Runtime extraction

1. Move audited code into gateway-owned runtime modules one boundary at a time.
2. Replace adapter internals with native gateway implementations.
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
- network calls that bypass gateway-owned adapters or bypass policy/audit logging

Security rule of thumb:

- if a pattern weakens auditability, makes failures implicit, or widens the trust boundary, it stays out of the gateway runtime

## Working rule

Treat the legacy snapshot as the source for audit and parity only. The gateway runtime should absorb the cleaned contract, not the legacy structure.
