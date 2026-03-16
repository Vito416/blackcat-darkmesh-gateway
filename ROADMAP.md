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
- Integrate `blackcat-crypto-manifests` to pin allowed keys/algos; verify manifest hash from Arweave.
- Wire ForgetSubject hook to Worker (delete-on-download + TTL cache wipe).
- Align webhook retry/breaker metrics with AO/Write (`write.webhook.*`, `write.psp.*`) and expose via Prom endpoint.
- Add E2E test harness: fake PSP + worker + write ingest to validate encrypted checkout → AO state.

## Testing/Tooling
- E2E harness with fake PSP + scripted webhooks.
- Chaos tests for breaker/retry; cache wipe after ForgetSubject.
- Load tests for cache under concurrent browsers.
