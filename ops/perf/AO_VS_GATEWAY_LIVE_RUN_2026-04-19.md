# AO vs Gateway live benchmark run - 2026-04-19

## Environment
- Gateway URL: `https://gateway.blgateway.fun`
- AO public API URL: configured upstream used by gateway (`/api/public/*`)
- Profile: production-like smoke benchmark
- Tooling: `scripts/build-ao-vs-gateway-scenarios.js`, `scripts/benchmark-ao-vs-gateway.js`

## Artifacts
- Scenario file: `config/bench/ao-vs-gateway.scenarios.live.json` (local operator artifact; ignored)
- Raw benchmark report: `tmp/bench/ao-vs-gateway.20260419T085558Z.json`
- Raw benchmark report (rerun after worker hardening): `tmp/bench/ao-vs-gateway.20260419T095242Z.json`

## Result summary
Benchmark completed, but the compared paths are not in a healthy state yet, so p95/RPS comparisons are **not release-meaningful**.

Observed status patterns:
- `public.site-by-host`
  - AO direct: `502 INVALID_UPSTREAM_RESPONSE` (`invalid_registry_response`)
  - Gateway: `502`
- `public.resolve-route`
  - AO direct without site scope: `400 site_id_required`
  - AO direct with site scope + template token: `500 internal_error`
  - Gateway: `500`/timeouts under load
- `public.get-page`
  - AO direct without upstream template token: `401 unauthorized`
  - AO direct with upstream template token: `500 internal_error`
  - Gateway: `500`/timeouts under load

## Interpretation
- Benchmark tooling works end-to-end and writes reproducible JSON reports.
- The current live upstream data plane is returning functional errors (`502`/`500`/`401`), so the run currently measures failure behavior rather than AO-vs-gateway performance.

## Required before next benchmark run
1. Fix upstream `GetSiteByHost`/registry response path (remove `invalid_registry_response`).
2. Fix `resolve-route` and `page` server-side internal errors for valid site-scoped calls.
3. Re-run benchmark with healthy expected statuses (`200/404`) and then evaluate p95/RPS deltas.

---

## Rerun update (after upstream worker hardening deploy)

Applied before rerun:
- worker endpoint hardening deployed:
  - `site-by-host`: empty/atom output now maps to `404 NOT_FOUND` instead of generic `502`
  - read-path timeout failures now return explicit `504 ao_read_timeout` (instead of generic `500 internal_error`)
  - `GATEWAY_READ_TIMEOUT_MS` increased from `30000` to `60000` in production worker vars
- benchmark scenario generator updated:
  - `public.site-by-host` accepts `[200, 404]` to allow unbound-host runs
  - AO auth headers can be injected for benchmark scenarios (`--ao-api-token`, `--ao-bearer-token`, `--ao-template-token`)

Rerun snapshot (`tmp/bench/ao-vs-gateway.20260419T095242Z.json`):
- `public.site-by-host`
  - AO success: `19/24`
  - Gateway success: `17/24`
  - remaining failures: intermittent `502` from upstream semantic path
- `public.resolve-route`
  - AO success: `0/24`
  - Gateway success: `0/24`
  - dominant failures: upstream `502` and request timeouts
- `public.get-page`
  - AO success: `0/24`
  - Gateway success: `0/24`
  - dominant failures: upstream `502` and request timeouts

Conclusion after rerun:
- Hardening improved error semantics and observability (no opaque `internal_error` on read timeouts).
- However, AO read semantic readiness for route/page remains blocked; A/B performance comparison is still not release-meaningful until AO read responses are consistently semantic (`status=OK|ERROR` envelopes).
