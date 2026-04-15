# Migration Backlog (P0/P1/P2)

This backlog is written to avoid re-discovery work and to make execution straightforward.

## Tracker

- Status legend: `[ ]` not started, `[~]` in progress, `[x]` done.
- P1 operator/runbook debt is tracked explicitly in `ops/decommission/P1_RUNBOOK_DEBT_BACKLOG.md` (P1-01..P1-06).

- Gateway-side implementation is complete for the current migration slice; the remaining blockers are AO-side registry/authority lifecycle work plus the final decommission evidence, and those AO blockers remain open.
- Machine-validated release evidence is now available from `build-release-evidence-pack`, `validate-ao-dependency-gate`, `build-release-signoff-checklist`, and the consistency drift report/summary artifacts produced by `build-drift-alert-summary`.
- Preferred operator path is `scripts/run-release-drill.js`; it captures the matrix, drift report/summary, AO gate validation output, release pack, signoff checklist, readiness JSON, drill manifest, strict manifest validation log, and drill artifact check JSON as one drill bundle.
- Closeout automation is complete via `run-decommission-closeout`, `build-release-evidence-ledger`, `build-decommission-evidence-log`, `check-decommission-manual-proofs`, `check-decommission-readiness`, `check-ao-gate-evidence`, and `validate-hosting-readiness` (deployment-profile readiness validator), but the final state is still split as `automation-complete` plus `ao-manual-pending` until the AO/manual proofs land.
- `ops/decommission` now has a complete strict artifact set (matrix/report/pack/readiness/drill-manifest/drill-check/ledger), and machine checks report `automationState=complete` with AO-only blockers.
- Worker-routing and secrets-boundary tooling is now being tracked alongside the gateway libs workstream: `check-template-worker-routing-config`, `init-template-worker-routing`, and `validate-worker-secrets-trust-model` form the public-template/worker boundary checks, but they are guardrails only and do not change AO blocker status.
- SignatureRef pinning is now enforced at runtime for template workers, and the routing-map coherence validators keep the URL/token/signatureRef maps aligned before release artifacts are published; these remain gateway-side guardrails and do not alter the AO blocker state.
- The forget-forward path now has a dedicated config validator so the optional forward relay stays explicit, bounded, and fail-closed on malformed config while the local purge path remains available.
- Release-pack optional evidence now includes template worker map coherence + forget-forward config artifacts; pre-spawn empty maps are treated as pass-baseline evidence, while configured maps run strict fail-closed validation.
- Legacy crypto boundary evidence is now machine-checkable (`check-legacy-crypto-boundary-evidence`) and included in release-drill / release-pack metadata so verification-only constraints are audited with the rest of the decommission bundle.
- Release-drill evidence now carries expanded metadata (`release-drill-manifest.json`, strict manifest validation output, `release-drill-check.json`, and `release-drill-checks.json`) so the closeout bundle can be audited without re-running the drill.
- Release-drill strict artifact requirements are now centralized and shared across generator/checkers (`run-release-drill`, `check-release-drill-artifacts`, `check-decommission-readiness`) with alias-compatibility warnings for older artifact names.
- Latest hardening notes: `/template/call` now fail-closes on recursive secret-smuggling fields, `/cache/forget` stays local-200 even when optional worker forwarding times out, the gateway-owned core hash primitive is backed by `src/runtime/core/hash.ts` and `tests/runtime-core-hash.test.ts`, and `tsconfig.json` has moved to `NodeNext` so the old `moduleResolution=node10` deprecation path is gone.
- New cross-repo dataflow checker (`scripts/audit-cross-repo-dataflow.js`) now validates gateway<->AO<->write<->worker contract coherence; role-binding P0 was closed (worker + write canonical now include role, and worker `/sign` allowlist accepts role fields).
- Host->site resolution now supports `map|ao|hybrid` mode with AO lookup endpoint `/api/public/site-by-host`, timeout/TTL controls, and production-like fail-closed behavior by default.
- Baseline HTTP security headers now include HSTS + COOP + CORP, and sensitive control-plane routes (`/integrity/state`, `/integrity/incident`, `/cache/forget`, `/metrics`) now consistently return `cache-control: no-store`.
- New operator shortcut: `ops:check-production-readiness` emits concise GO/NO-GO with actionable blocker groups (`automation` vs `aoManual`).
- Fresh-machine rollout runbook now exists at `ops/fresh-machine-production-bootstrap-runbook.md` and is linked from `ops/README.md` and `ops/release-drill-runbook.md`.
- Treat that output as machine-checked evidence only; AO gate closure and manual evidence still need separate drill logs, rollback proof, and human sign-off before decommission.
- Validator ordering for operator drills is now fixed: build the drill bundle, validate the drill manifest, check drill artifacts, build the evidence ledger/log, then run closeout readiness and AO gate evidence checks before any sign-off is recorded.
- Evidence quality split is mandatory in every note/log: `automation-complete` covers machine outputs only, while `ao-manual-pending` and `ao-manual-blocked` cover AO-side closure, rollback proof, and human approvals that still need to land or are still blocked.
- Boundary reference for template/public/gateway/worker secret handling: `ops/worker-secrets-trust-model.md`.

### Worker-routing and trust-model enforcement

- `check-template-worker-routing-config` validates the published tenant URL/token map before routing is published.
- `check-template-signature-ref-map` and the routing-map coherence checks keep the URL/token/signatureRef maps in sync before release artifacts are published.
- `init-template-worker-routing` is scaffold-only and exists to prepare a new routing set without granting extra privileges.
- `validate-worker-secrets-trust-model` documents the public-template/gateway/worker split and should be treated as the machine companion to `ops/worker-secrets-trust-model.md`.
- `check-forget-forward-config` keeps the optional forget-forward relay explicit and bounded, without changing the local forget-path behavior.
- `run-release-drill` now records the expanded drill metadata set alongside the standard evidence bundle so closeout artifacts stay machine-auditable.
- Final decommission still needs the archived routing map/token map, the trust-model validation log, and the closeout bundle that proves worker secrets stayed out of request-path runtime.

### Gateway libs consolidation workstream

This workstream is gateway-owned and can progress against the legacy module inventory now; it does not depend on AO closeout being finished first.

- [x] Keep `ops/decommission/LEGACY_INTEGRATION_AUDIT.md` current for every imported snapshot module (includes target path, status, and explicit decommission condition per module).
- [x] Map runtime usage away from direct legacy imports (`rg -n "libs/legacy" src` -> no matches).
- [x] Runtime config boundary enforcement exists and is CI-gated (`npm run ops:check-config-loader-runtime-boundary -- --strict`, covered by `tests/check-config-loader-runtime-boundary.test.ts`).
- [x] Legacy no-import evidence checker exists and is CI-gated (`npm run ops:check-legacy-no-import-evidence -- --strict --json`, covered by `tests/check-legacy-no-import-evidence.test.ts`).
- [x] Initial request-path extraction landed for runtime helpers:
  - `src/runtime/auth/httpAuth.ts`
  - `src/runtime/crypto/safeCompare.ts`
  - `src/runtime/config/profile.ts`
  - `src/runtime/sessions/replayStore.ts`
  - `src/runtime/template/actions.ts` + `src/runtime/template/validators.ts`
- [x] Additional extraction landed for operational helpers:
  - `src/runtime/mailing/payloadPolicy.ts` + `src/runtime/mailing/sanitizer.ts`
  - `src/runtime/payments/providers.ts` + `src/runtime/payments/validators.ts`
  - `src/runtime/telemetry/analyticsEvent.ts` + `src/runtime/telemetry/analyticsPolicy.ts`
- [x] Do-not-port rules are documented for runtime in `ops/decommission/LEGACY_INTEGRATION_AUDIT.md`.
- [x] Decommission conditions are now tracked per module in `ops/decommission/LEGACY_INTEGRATION_AUDIT.md`.
- [~] `blackcat-config`: keep the gateway-owned config loader/profile contract aligned with request-path usage, then capture decommission proof once the removal evidence is archived.
  - Progress note: typed config loader with source metadata now lives in `src/runtime/config/loader.ts` and is covered by `tests/runtime-config-loader.test.ts`.
  - Progress note: loader wiring is active in request-path modules (`src/templateApi.ts`, `src/handler.ts`, `src/webhooks.ts`, `src/ratelimit.ts`, `src/replay.ts`).
- [x] `blackcat-core`: extracted; byte, JSON, canonical JSON, hash, and template helpers now live in gateway-owned runtime code, and decommission evidence is machine-checkable via `check-legacy-core-extraction-evidence`.
  - Progress note: JSON-safe core parsing helpers landed in `src/runtime/core/json.ts` with focused tests in `tests/runtime-core-json.test.ts`.
  - Progress note: the canonical JSON primitive now has a gateway-owned implementation in `src/runtime/core/canonicalJson.ts`; keep primitive-by-primitive mapping notes aligned as coverage expands.
  - Progress note: deterministic SHA-256 helpers now live in `src/runtime/core/hash.ts` with focused coverage in `tests/runtime-core-hash.test.ts`.
- [x] `blackcat-crypto`: extracted; signature comparison, HMAC, and signature-ref helpers now live in gateway-owned runtime code, and decommission evidence now includes a machine-checkable verification-only boundary gate (`check-legacy-crypto-boundary-evidence`).
  - Progress note: signature-ref normalization/validation helpers now live in `src/runtime/crypto/signatureRefs.ts` with focused coverage in `tests/runtime-crypto-signatureRefs.test.ts`; the verification boundary stays independent from wallet/private-key logic.
  - Progress note: HMAC verification now has a gateway-owned helper in `src/runtime/crypto/hmac.ts` with focused coverage in `tests/runtime-crypto-hmac.test.ts`.
- [~] `blackcat-auth`: keep the HTTP auth and role/signature policy helpers aligned with request-path modules, then capture the removal proof once the legacy path stays unused.
  - Progress note: shared role/signature-ref policy helpers now live in `src/runtime/auth/policy.ts` and are reused by template + integrity paths.
- [~] `blackcat-sessions`: keep the replay store and session lifecycle boundary aligned with request-path usage, then capture removal proof once the legacy path is unused.
  - Progress note: lifecycle helper is now available in `src/runtime/sessions/lifecycle.ts` with create/read/rotate/revoke semantics and focused tests.
- [~] `blackcat-auth-js`: client boundary exists under `src/clients/auth-sdk/client.ts` with focused tests (`tests/clients-auth-sdk.test.ts`); next is ownership documentation and removal evidence before any decommission status change.
  - Progress note: client hardening enforces URL safety + optional host allowlist and deterministic response parsing behavior.
- [~] `blackcat-crypto-js`: client boundary exists under `src/clients/crypto-sdk/client.ts` with focused tests (`tests/clients-crypto-sdk.test.ts`); next is ownership documentation and removal evidence before any decommission status change.
  - Progress note: client boundary now enforces URL safety and optional host allowlists with deterministic body parsing.
  - Progress note: client hardening now enforces URL safety + optional host allowlist and deterministic response parsing behavior.
- [~] `blackcat-mailing`: queue/transport/delivery groundwork exists (`src/runtime/mailing/queue.ts`, `src/runtime/mailing/transport.ts`, `src/runtime/mailing/delivery.ts`); ownership and request-path secret boundary are now explicit, and the remaining open item is final decommission evidence packaging.
  - Progress note: delivery outcome states, deterministic retry cadence/backoff, and a delivery orchestrator helper now exist (`src/runtime/mailing/delivery.ts`, `tests/runtime-mailing-delivery.test.ts`).
  - Progress note: ownership is now fixed to gateway public queue/transport + worker-owned secret credentials (`ops/worker-secrets-trust-model.md`), with machine enforcement via `scripts/check-mailing-secret-boundary.js` and `tests/check-mailing-secret-boundary.test.ts`.
- [~] `blackcat-gopay`: provider/validator helpers now have webhook verification and idempotency groundwork (`src/runtime/payments/gopayWebhook.ts`, `src/runtime/payments/webhookIdempotency.ts`, `/webhook/gopay` in `src/handler.ts`, `tests/handler-gopay-webhook.test.ts`); the remaining open item is the final payment-boundary decommission evidence.
- [~] `blackcat-analytics`: sink/export boundary now has a runtime retention/drop helper and coverage; keep the final destination decision and decommission evidence aligned once accepted/dropped paths stay deterministic.
- [~] `blackcat-installer`: do-not-port candidate; keep installer logic ops-only (`ops/` + `scripts/`), and enforce zero request-path imports from installer legacy paths.
  - Progress note: runtime boundary check exists via `scripts/check-installer-runtime-boundary.js` with coverage in `tests/check-installer-runtime-boundary.test.ts`.

### Current wave next actions (core + client boundaries + mailing/GoPay)

- [~] `src/runtime/core/` extraction:
  - Commit the core helper boundary shape (`src/runtime/core/bytes.ts` + `src/runtime/core/index.ts`) and keep call sites on runtime-core imports only.
  - Progress note: JSON-safe parsing helpers now landed under `src/runtime/core/json.ts` and are exported via `src/runtime/core/index.ts`.
  - Progress note: the canonical JSON primitive is now represented by `src/runtime/core/canonicalJson.ts`; update the primitive mapping notes before marking any core legacy mapping complete.
  - Add/retain focused tests for core byte helpers (`tests/runtime-core-bytes.test.ts`) and ensure template body-limit behavior stays covered in `tests/template-api.test.ts`.
  - Extend `ops/decommission/LEGACY_INTEGRATION_AUDIT.md` primitive mapping notes for every newly extracted core helper before decommission state changes.
- [~] auth-js/crypto-js client boundaries:
  - Harden and merge the current client boundaries (`src/clients/auth-sdk/client.ts`, `src/clients/crypto-sdk/client.ts`) with explicit ownership notes and zero request-path runtime coupling.
  - Keep and expand boundary contract coverage (`tests/clients-auth-sdk.test.ts`, `tests/clients-crypto-sdk.test.ts`) before any legacy JS removal decision.
  - Wire docs so map/plan/decommission files all point to the same boundary paths and status (`extracted` for core/crypto, `pending (do-not-port candidate)` for installer).
- [~] mailing queue + transport progression:
  - Finalize the runtime queue/transport boundary (`src/runtime/mailing/queue.ts`, `src/runtime/mailing/transport.ts`) and document the configuration contract (endpoint/token/timeout).
  - Keep and expand focused queue/transport coverage (`tests/runtime-mailing-transport.test.ts`) plus one delivery-path integration assertion.
  - Decision recorded: gateway keeps public-safe queue/transport/delivery intent; worker owns secret-bearing dispatch credentials, enforced by the mailing secret-boundary check.
- [~] GoPay webhook + idempotency adapter progression:
  - Keep `/webhook/gopay` verification path on the runtime-owned helper (`src/runtime/payments/gopayWebhook.ts`) with focused route tests (`tests/handler-gopay-webhook.test.ts`).
  - [~] Extract provider-agnostic webhook idempotency adapter under `src/runtime/payments/` and use it for GoPay duplicate-write defense.
  - Added explicit idempotency tests (duplicate event id / missing id / conflicting payload) to keep GoPay migration evidence moving.

## This week execution

- [gateway] Keep the integrity gate aligned with the live AO snapshot shape and retain the new smoke/CI checks as the default path.
- [gateway] Finish the last parity coverage for upgrade activation/cancel, rollback acceptance, revoked root rejection, and stale-state defense.
- [ao] Close the registry actions for publish/revoke/query/pause state so gateway consumers can trust one stable API surface.
- [ao] Finalize `root/upgrade/emergency/reporter` lifecycle and audit commitment sequencing/query surfaces for the v1.4.0 workflow.
- [ops] Capture the remaining decommission artifacts: recovery drill timestamps, AO fallback drill, and rollback proof, then record the sign-off.

## Open blockers

### Gateway-side remaining work
- No known functional blocker remains on the gateway slice for v1.4.0.
- Keep the integrity gate and migration docs aligned with any late AO/API shape changes.

### AO-side dependencies
- Final AO registry actions for publish/revoke/query/pause state.
- AO authority lifecycle completion for `root/upgrade/emergency/reporter`.
- AO audit commitment sequencing/query surface and release-root parity in the snapshot API.

### Evidence-only tasks before decommission
- Recovery drill timestamps captured in the notes.
- AO outage fallback drill artifact captured and linked.
- Rollback proof captured for at least one failure scenario.
- Final stakeholder sign-off recorded against the checklist.

- [~] P0.1 AO integrity registry contract surface (AO PR in flight; registry authority/audit extensions underway)
- [~] P0.2 Gateway artifact verifier (core verifier + cache enforcement landed; AO release-root parity still pending)
- [~] P0.3 Policy pause + degraded mode (runtime gate landed; checkpoint restore/fallback coverage expanded)
- [x] P0.4 Migration parity tests
- [~] P1.1 Authority separation and rotation workflow (gateway role-aware signature-ref gate + runbook landed; AO-side final authority lifecycle remains)
- [~] P1.2 Audit commitments stream (gateway audit seq/lag metrics landed; AO-side commitment sequencing integration still pending)
- [x] P1.3 Signed local checkpoint (gateway)
- [~] P1.4 Incident/reporting hooks (incident/state endpoints + metrics + tests landed; operator automation/runbook hardening remains)
- [x] P2.1 Verification scheduling optimizations
- [x] P2.2 Resource budgets and limits
- [x] P2.3 Optional diskless mode

## P0 - Mandatory before kernel repo retirement

### P0.1 AO integrity registry contract surface
- Define/implement AO actions for:
  - publish/revoke release
  - query trusted root / release by version / release by root
  - policy pause state query
- Add role/signature enforcement for registry-mutating actions.
- Add replay/idempotency tests for registry writes.
- Add authority and audit commitment actions for the v1.4.0 workflow.

Acceptance:
- AO tests prove trusted/untrusted/revoked root transitions.
- Gateway can fetch a stable trusted-root snapshot from AO.

Progress notes:
- AO registry actions and authority/audit extensions remain the open work.
- Gateway consumers are waiting on the final stable AO snapshot/API shape; no further gateway-side unblocker is expected here.

### P0.2 Gateway artifact verifier
- Add module to verify fetched template bundles against AO trusted roots.
- Cache verification status and block serving unverified artifacts.
- Add strict error classes:
  - `integrity_mismatch`
  - `missing_trusted_root`
  - `policy_paused`

Acceptance:
- unit tests for pass/fail/hash-mismatch/revoked-root paths.
- metrics increment on block.

### P0.3 Policy pause + degraded mode
- Add gateway runtime gate controlled by AO policy state.
- Implement read-only fallback behavior for mutable endpoints.
- Ensure deterministic response codes and audit logs.
- Restore from checkpoint when AO fetch fails; fall back to env state only when no checkpoint exists.

Acceptance:
- integration test: when `paused=true`, mutating endpoints fail closed.

### P0.4 Migration parity tests
- Translate critical kernel scenarios:
  - pending upgrade activation/cancel
  - revoked root rejection
  - compatibility rollback acceptance
  - stale check-in defensive path (if modeled in gateway)

Acceptance:
- parity test matrix exists and passes in CI.

## P1 - Security hardening and operational maturity

### P1.1 Authority separation and rotation workflow
- Model `root/upgrade/emergency/reporter` authority set in AO state.
- Add rotatable signer references and migration-safe key update flow.
- Add explicit key-rotation runbook and tests.

Progress notes:
- Gateway incident actions can enforce role-aware `signatureRef` (`pause/resume` -> emergency/root; `ack/report` -> reporter/emergency/root).
- Authorization refs are sourced from AO snapshot authority and can be safely overlapped via `GATEWAY_INTEGRITY_ROLE_*_REFS` during rotation windows.
- Runtime auth boundary helpers now live in `src/runtime/auth/policy.ts` with deterministic deny codes for role and signature-ref checks, so template and integrity paths can reuse the same overlap-safe enforcement.
- Operator runbook added: `ops/integrity-runbook.md`.

### P1.2 Audit commitments stream
- Implement AO audit commitment entries (`seqFrom/seqTo/merkleRoot/metaHash`).
- Correlate gateway events with AO commitment sequences.

Progress notes:
- Gateway now exports audit sequence and lag gauges from integrity snapshots:
  - `gateway_integrity_audit_seq_from`
  - `gateway_integrity_audit_seq_to`
  - `gateway_integrity_audit_lag_seconds`
  - `gateway_integrity_checkpoint_age_seconds`
- Remaining work is the AO-side commitment sequencing and immutable audit stream/query API.

### P1.3 Signed local checkpoint (gateway)
- Persist last valid integrity snapshot with signature/hash.
- Restore only if the checkpoint verifies and is younger than the max-age policy.
- Treat stale checkpoints as absent so AO fetch remains the source of truth.

Progress notes:
- Checkpoint envelope now includes signed metadata (`writtenAt`, optional `expiresAt`).
- Max-age policy via `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS` fails closed on stale/invalid checkpoint data.
- Legacy checkpoint envelope compatibility is preserved when max-age enforcement is not configured.

### P1.4 Incident/reporting hooks
- Add incident action path and metrics pipeline.
- Add operator runbook for pause/resume and incident ack.

Progress notes:
- `POST /integrity/incident` supports authenticated `report|ack|pause|resume`.
- `GET /integrity/state` exposes runtime policy state and latest AO/checkpoint snapshot envelope.
- Metrics added: incident accepted/auth-blocked/notify ok/notify fail + state read/auth-blocked.
- Coverage added in `tests/integrity-incident.test.ts`.
- Replay/idempotency dedupe and the smoke helper are in place; remaining work is operator automation and final staging evidence.
- Operator automation now includes helper scripts for evidence export/validation/bundle checks plus workflow dispatch dry-run (`dispatch-consistency-smoke`, `latest-evidence-bundle`, `check-evidence-bundle`).

## P2 - Performance and platform polish (shared-VPS-first)

### P2.1 Verification scheduling optimizations
- Verify on startup/cache-fill/state-change only.
- Add bounded refresh strategy for hot artifacts.

Progress notes:
- Integrity fetch client now supports bounded timeout + retry/backoff controls:
  - `AO_INTEGRITY_FETCH_TIMEOUT_MS`
  - `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS`
  - `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS`
- Profiled cadence defaults are now available via `GATEWAY_RESOURCE_PROFILE=vps_small|vps_medium|diskless`.
- Precedence is explicit: call override > `AO_INTEGRITY_FETCH_*` env > `GATEWAY_RESOURCE_PROFILE` > medium fallback.
- Alert guidance is now calibrated per profile in `ops/alerts-profiles.md`.
- Doc/code sync tests now guard profile tuning drift (`tests/profile-tuning-sync.test.ts`) for fetch defaults, anti-flap windows, and checkpoint stale threshold safety.
- Validation errors still fail closed immediately (no retry on invalid snapshot payloads).
- No open gateway-side follow-up remains beyond AO-side cadence/input finalization.

### P2.2 Resource budgets and limits
- Cap verifier CPU/timeouts.
- Bound cache size, ratelimit bucket cardinality, replay-window growth, and checkpoint history length.
- Add stress tests for constrained memory and resource-constrained deployment profiles.

Progress notes:
- Cache admission bounds implemented (`GATEWAY_CACHE_MAX_ENTRY_BYTES`, `GATEWAY_CACHE_MAX_ENTRIES`).
- Ratelimit/replay map growth bounds implemented (`GATEWAY_RL_MAX_BUCKETS`, `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS`).
- Focused stress/hardening tests added:
  - `tests/rate-replay-limits.test.ts`
  - `tests/resource-hardening.test.ts`
- Budget observability completed:
  - cache reject reason counters
  - ratelimit/replay prune counters and config gauges
- Production presets documented in `ops/resource-budgets.md` and `config/example.env`.
- This slice is complete on the gateway side; remaining work is mostly deployment evidence and AO-side rollout coupling.

### P2.3 Optional diskless mode
- Ensure gateway works even without local checkpoint writes.
- Keep correctness through AO fetch + memory-only verification.
- Prefer tmpfs or no checkpoint path over fragile persistent storage on small hosts.

Progress notes:
- Explicit memory-only operation is now available via:
  - `GATEWAY_INTEGRITY_DISKLESS=1`, or
  - `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless|disabled|memory-only`
- In memory-only mode checkpoint read/write paths no-op safely (AO + env fallback remain active).
- Integration coverage includes diskless mode behavior when AO is unavailable (`tests/integrity-policy-gate.test.ts`).
- No additional gateway-side code remains for the optional diskless path.

## P3 - Nice-to-have / ecosystem scale

- Multi-region verifier consistency checks.
- Cross-gateway attestation exchange.
- Additional formal validation of integrity state transitions.

### P3 execution layer
- Mirror consistency checks across gateways to compare integrity snapshots and catch drift early.
- Cross-gateway compare tooling for operator spot checks and escalation evidence.
- Adaptive per-prefix route rate limits for tenant-aware burst control on hot paths.

Progress notes:
- P3 consistency tooling is now tracked end-to-end: compare output, attestation JSON, and manual smoke dispatch are the evidence targets; implementation is still in flight.
- Preferred P3 operator path is now evidence export first, attestation validation second, then manual dispatch only when the bundle is complete.
- CI `evidence-dry-run` now exercises the same export + validation chain to catch operator workflow drift before manual dispatch.
- CI `evidence-dry-run` also exercises latest-bundle selection, strict bundle checks, and workflow dispatch payload dry-run to keep the full operator chain regression-safe.
- New helper scripts now cover the operator-facing P3 loop:
  - `scripts/compare-integrity-matrix.js` for pairwise/all-gateway drift checks.
  - `scripts/build-attestation-exchange-pack.js` for cross-gateway evidence exchange bundles.
  - `scripts/index-evidence-bundles.js` for strict/portable bundle indexing (JSON/CSV).
  - `scripts/suggest-ratelimit-overrides.js` for profile-aware rate-limit override suggestions from traffic stats.
- CI wiring now exercises these helpers in `consistency-smoke` / `evidence-dry-run` (matrix compare + strict index + exchange-pack generation + help coverage).
- `consistency-smoke` now captures matrix JSON, generates a profile-aware drift report (`build-drift-alert-summary`), appends it to the job summary, and uploads consistency artifacts.
- `evidence-dry-run` now uploads its generated evidence directory as a CI artifact for offline review/sign-off.
- Weekly scheduled consistency smoke is enabled in CI (requires `CONSISTENCY_URLS`; optional `CONSISTENCY_MODE` and `GATEWAY_RESOURCE_PROFILE`).
- Dispatch helper now supports `--consistency-mode` and `--consistency-profile` so manual operator runs can match scheduled profile behavior.
- Scheduled consistency now performs a fail-fast config preflight and reports missing/invalid vars/secrets in the job summary.
- CI now builds and uploads a consolidated `release-evidence-pack` artifact (`.md` + `.json`) from consistency + evidence outputs on manual release drills.
- AO dependency gate is now machine-readable in `ops/decommission/ao-dependency-gate.json`; release pack generation requires this gate when `--require-ao-gate` is used.

## v1.4.0 release-ready checklist

Use this checklist before merge/release sign-off.

- Automation complete, awaiting AO/manual proofs: the closeout helpers can build the final evidence bundle, but AO gate closure and manual proof links still need to be recorded before decommission sign-off.
- Current blocker snapshot (`2026-04-12T16:35:12Z`):
  - Implementation health is green (`npm test`, strict legacy boundary checks, strict template contract checks, strict profile check against `config/example.env`).
  - Release/decommission closeout is blocked until drill artifacts are generated in `ops/decommission/` and linked in the final evidence pack.
  - AO dependency gate required checks remain `in_progress` and prevent a GO decision.

- Live strict drill snapshot (`2026-04-14T13:00Z`, `gateway.blgateway.fun`):
  - Prod-like deep check is green (`PASS=7`, `WARN=0`, `FAIL=0`).
  - `/integrity/state` now serves a complete snapshot (`policy` + `release` + `authority` + `audit`) from checkpoint fallback, so matrix compare passes.
  - Live strict drill now completes through artifact + readiness checks; remaining blocker is manual proof log (`decommission-evidence-log.json`) for final GO.

- [ ] AO registry/authority lifecycle items are complete (`publish/revoke/query/pause`, `root/upgrade/emergency/reporter`, audit sequence surface).
- [ ] `ops/decommission/ao-dependency-gate.json` required checks are updated to `closed` with evidence links.
- [ ] Gateway `main` CI is green on full tests, integrity gate, and smoke jobs.
- [ ] Scheduled consistency preflight is passing with repository configuration in place:
  - [ ] `CONSISTENCY_URLS` (at least two valid URLs)
  - [ ] `CONSISTENCY_MODE` (optional, `pairwise|all`)
  - [ ] `GATEWAY_RESOURCE_PROFILE` (optional, `vps_small|vps_medium|diskless`)
  - [ ] `GATEWAY_INTEGRITY_STATE_TOKEN` secret (required unless `CONSISTENCY_ALLOW_ANON=1`)
- [ ] Latest consistency-smoke artifacts are archived (`consistency-matrix.json`, drift report `.md`, drift summary `.json`).
- [ ] Latest machine-validated release evidence is archived (`release-evidence-pack.md`, `release-evidence-pack.json`, `build-release-signoff-checklist` output, `check-release-readiness --json` output, `ao-dependency-gate.validation.txt`, drift report `.md`, drift summary `.json`, `legacy-core-extraction-evidence.json`, `legacy-crypto-boundary-evidence.json`, `release-drill-manifest.json`, `release-drill-check.json`, `release-drill-checks.json`, `release-evidence-ledger.md`, `release-evidence-ledger.json`, `decommission-evidence-log.md/.json`, `check-decommission-manual-proofs` output) and the closeout log shows `automation-complete` plus `ao-manual-pending` or `ao-manual-blocked` as applicable.
- [ ] Preferred operator drill path is `scripts/run-release-drill.js`; archive the matrix, drift report/summary, `ao-dependency-gate.validation.txt`, release pack, signoff checklist, readiness JSON, `legacy-core-extraction-evidence.json`, `legacy-crypto-boundary-evidence.json`, `release-drill-manifest.json`, `release-drill-check.json`, `release-drill-checks.json`, and release evidence ledger (`.md` + `.json`) from one run.
- [ ] Archived drill bundle includes `legacy-core-extraction-evidence.json`, `legacy-crypto-boundary-evidence.json`, `release-drill-manifest.json`, strict validation output, `release-drill-check.json`, `release-drill-checks.json`, and release evidence ledger (`release-evidence-ledger.md` + `release-evidence-ledger.json`).
- [ ] Latest evidence-dry-run artifact bundle is archived and strict bundle checks are passing.
- [ ] Manual evidence is archived separately from machine validation: recovery drill timestamp, AO fallback drill proof, rollback proof, and stakeholder sign-off.
- [ ] Recovery drill timestamp, AO fallback drill proof, and rollback proof are linked in release notes.
- [ ] Stakeholder approval/sign-off recorded for decommission transition.

## Suggested execution order

1. P0.1 + P0.2
2. P0.3 + P0.4
3. P1.1
4. P1.2 + P1.4
5. P1.3
6. P2

## Exit criteria (migration complete)

- All P0 items finished and tested.
- P1.1 implemented (authority rotation cannot be missing).
- Gateway blocks unverified/revoked artifacts in production mode.
- AO integrity APIs documented and versioned.
