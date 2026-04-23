# Cross-Repo Implementation Backlog (Batch from 6 audits)

Date: 2026-04-13
Scope: blackcat-darkmesh-write, blackcat-darkmesh-ao, blackcat-darkmesh-gateway/workers, blackcat-darkmesh-gateway

## P0 (implement now)

1. Worker site-isolation hardening (`/api/checkout/*`, `/sign`)
   - Enforce canonical site binding (`body.siteId`, `payload.siteId`, headers must match or reject).
   - Bind policy decisions to signed fields; include `siteId` + `signatureRef` in canonical detached signature.
   - Add regression tests for cross-site mismatch bypass attempts.

2. Gateway internal plane hardening
   - Lock down `/cache/*`, `/cache/forget`, `/inbox` by default with explicit auth gates.
   - Make auth fail-closed for production-like profiles.

3. Gateway request-body DoS guard
   - Enforce max body size before full buffering in node adapter.
   - Keep route-level limits as second line, but fail early with 413.

4. Gateway webhook E2E write flow completeness
   - Forward verified PSP webhooks to write command path and preserve replay protection behavior.
   - Add integration tests proving gateway -> write adapter -> AO normalization path.

5. Write checkout adapter hardening
   - Default `WRITE_API_ACCEPT_EMPTY_RESULT=0`.
   - Require auth token in prod-like mode (or explicit unsafe override).
   - Align error contract when result/compute payload is empty.

## P1 (next batch)

1. AO read adapter parity
   - Close docs-vs-runtime action mismatch (declared reads vs implemented reads).
   - Separate read auth from OUTBOX_HMAC ingest/write secret requirements.

2. Trusted proxy + host binding controls in gateway
   - Add trusted-proxy mode for forwarded headers.
   - Fail-closed host derivation without trusted proxy.

3. Cross-repo E2E contract tests
   - Add runtime E2E read/write tests (not only static bridge checks).
   - Wire CI commands for e2e dataflow matrix.

## P2 (future-proof)

1. Replay atomicity improvements in worker (Durable Object / atomic claim pattern).
2. Replace residual PHP lint helper with Node equivalent in gateway security policy tooling.
3. Expand runbook drills with executable webhook/write/degradation flows.
