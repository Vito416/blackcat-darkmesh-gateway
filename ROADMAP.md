# Gateway Roadmap (draft)

## Phase 1 – MVP (parity with current AO/Write/Worker)
- Serve Arweave template (hash-verified) + cache with TTL.
- Proxy core API: cart/checkout/session → Write AO; public read → AO.
- Envelope cache with TTL + ForgetSubject wipe.
- PSP ingress: signature verify (one provider), retry/backoff queue, status → Write AO.
- Metrics: cache_hit/miss/expired, webhook_retry_lag, breaker_open.

## Phase 2 – Hardening & Observability
- Cert cache + OCSP refresh (PayPal/Stripe style).
- Circuit breaker per PSP endpoint; synthetic health checks.
- Prometheus/OpenMetrics endpoint with token auth.
- CSP/SRI/COOP headers and asset hash pinning.
- Replay defense on webhooks; HMAC on browser API (optional).

## Immediate next sprint
- Finish AO registry contract actions for publish/revoke/query/pause state.
- Finalize AO-side authority lifecycle for `root/upgrade/emergency/reporter` and record one clean rotation drill.
- Wire the AO audit commitment sequence/query path so gateway metrics map to immutable AO entries.
- Port the remaining parity scenarios into CI: upgrade activation/cancel, compatibility rollback, revoked root, stale state.
- Close the last decommission evidence gaps: recovery drill timestamps, AO outage fallback drill, rollback proof.
- Add a small staging smoke for the incident/control path using the new helper and keep it in the CI gate.
- Review the release notes and docs for the final `1.4.0`/migration cut so the old kernel repo can be retired cleanly.

## Phase 3 – Multi-tenant & Config
- Per-merchant config service (template txid, TTLs, PSP creds) with hot-reload.
- Admission control for envelopes (size/quota).
- Template manifest allowlist/denylist; unsafe-template warnings.
- Canary/shadow deploy of new PSP configs.

## Phase 4 – PQC & Future-proofing
- Hybrid PQC transport/signatures for gateway↔backend links (when libs stable).
- Manifest format v2 with alg identifiers and rotation schedule.
- Reproducible template builds + SBOM attach; integrity attestations.

## Phase 5 – Performance
- Edge render option: inject AO public state into cached template for ultra-low TTFB.
- Smart prefetch/early refresh for hot assets.
- Adaptive rate limits per route based on error budgets.

## Next TODO (crypto + worker alignment)
- Adopt `blackcat-crypto` envelope/HMAC: browser/worker encrypt to admin pubkey; gateway stays secretless.
- Integrate `security/crypto-manifests` to pin allowed keys/algos; verify manifest hash from Arweave.
- Wire ForgetSubject hook to Worker (delete-on-download + TTL cache wipe).
- Align webhook retry/breaker metrics with AO/Write (`write.webhook.*`, `write.psp.*`) and expose via Prom endpoint.
- Add E2E test harness: fake PSP + worker + write ingest to validate encrypted checkout → AO state.

## Next execution order (P0 rollout)
1. Land integrity client + verifier + policy gate + checkpoint helpers.
2. Run focused tests:
   - `npm test -- --run tests/integrity-client.test.ts`
   - `npm test -- --run tests/integrity-verifier.test.ts`
   - `npm test -- --run tests/integrity-policy-gate.test.ts`
   - `npm test -- --run tests/integrity-checkpoint.test.ts`
   - `npm test -- --run tests/integrity-parity.test.ts`
3. Run `npm test` and `npm run build` after the focused set passes.
4. Only then evaluate kernel-repo decommission readiness.

## Testing/Tooling
- E2E harness with fake PSP + scripted webhooks.
- Chaos tests for breaker/retry; cache wipe after ForgetSubject.
- Load tests for cache under concurrent browsers.
