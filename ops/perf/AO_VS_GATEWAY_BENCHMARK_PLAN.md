# AO vs Gateway A/B benchmark plan

Purpose:
- Verify with hard numbers when a pure AO request path is enough and when gateway data-plane adds value.
- Measure user-facing latencies and throughput for the same business reads (`public.*`) across two paths:
  - Direct AO read API
  - Gateway `/template/call` proxy path

## Scope

In scope:
- `public.site-by-host`
- `public.resolve-route`
- `public.get-page`
- p50/p90/p95/p99, mean, min/max, success ratio, and effective RPS

Out of scope:
- Browser rendering metrics (LCP/INP) - separate frontend test lane.
- Cross-region Anycast benchmarking - separate edge benchmark lane.
- Write auth flow (`checkout.*`) - separate worker/write benchmark lane.

## Test profiles

Use three profiles so results are comparable across runs:

1) `baseline-local`
- AO + gateway on same machine/network.
- Goal: isolate software overhead.

2) `vps-production-like`
- AO upstream remote, gateway on VPS path like production.
- Goal: real deployment behavior.

3) `stress`
- Increased requests/concurrency until failure rate rises.
- Goal: saturation point and error mode.

## Benchmark script

Run:

```bash
npm run ops:benchmark-ao-vs-gateway -- \
  --scenarios config/bench/ao-vs-gateway.scenarios.example.json \
  --out tmp/bench/ao-vs-gateway.$(date -u +%Y%m%dT%H%M%SZ).json \
  --json \
  --strict-status
```

The script:
- warms up both AO and gateway endpoints,
- runs fixed-request concurrent load,
- computes latency percentiles and RPS,
- compares gateway-over-AO deltas/ratios.

Preflight note:
- If AO read endpoints are auth-protected, include AO headers in the generated scenario (`--ao-api-token`, `--ao-bearer-token`, and/or `--ao-template-token`).
- If `resolve-route` enforces tenant scope, pass `--site-id` so the generated payload includes site binding.

## Acceptance criteria (initial)

Read-path production-like target:
- Gateway p95 <= AO p95 + 35ms
- Gateway success ratio >= 99.5%
- Gateway RPS >= 80% of direct AO RPS for read calls

If criteria fail:
- inspect `siteResolver` cache/breaker and front-controller cache TTL,
- inspect upstream timeout/retry values,
- inspect rate-limit and integrity guard blocks,
- capture traces/logs and rerun with same scenario file.

## Reproducibility checklist

- Pin exact scenario JSON committed in repo.
- Record commit hash for gateway and AO repos.
- Record environment tuple:
  - CPU/RAM class
  - Node version
  - gateway env profile (`GATEWAY_RESOURCE_PROFILE`, `NODE_ENV`)
  - AO upstream URL and gateway URL
- Save raw output JSON under `tmp/bench/`.

## Next lanes after this benchmark

1) Write lane (`checkout.create-order`, `checkout.create-payment-intent`) with signer path.
2) Auth lane (worker challenge + OTP + token handoff).
3) Multi-gateway selection lane (control-plane routing effectiveness by region/load).
