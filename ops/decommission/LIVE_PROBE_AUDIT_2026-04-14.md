# Live Probe Audit (Gateway runtime drift check)

Date: 2026-04-14  
Target: `https://gateway.blgateway.fun`

## Commands executed

- `bash ops/live-vps/local-tools/prodlike-deep-check.sh https://gateway.blgateway.fun`
- `bash ops/live-vps/local-tools/prodlike-site-variant-smoke.sh https://gateway.blgateway.fun`
- `node scripts/probe-ao-read-fallback.js --dryrun-base https://gateway.blgateway.fun --scheduler-base https://gateway.blgateway.fun --site-id site-alpha --strict --json`
- `bash scripts/run-live-strict-drill.sh --skip-forget-forward`

## Evidence

- `ops/decommission/live-probes/2026-04-14/prodlike-deep-check.txt`
- `ops/decommission/live-probes/2026-04-14/prodlike-site-variant-smoke.txt`
- `ops/decommission/live-probes/2026-04-14/ao-read-fallback-live-gateway.json`
- `ops/decommission/live-probes/2026-04-14/ao-read-fallback-live-gateway.md`
- `ops/decommission/live-probes/2026-04-14/run-live-strict-drill.txt`

## Findings (P0)

1. Live runtime still serves `Gateway skeleton` on config/read-adapter surfaces:
   - `GET /template/config` returns plain text instead of hardened JSON config shape.
   - `POST /api/public/resolve-route` and `POST /api/public/page` return non-JSON skeleton payloads.
   - AO fallback probe status: `fail` (all 4 probes parse-failed).

2. Query hard-rejection drift remains on live:
   - `GET /template/config?probe=1` returns `200` (expected hardened behavior is reject/fail-closed).

3. Strict live drill cannot pass yet:
   - `compare-integrity-matrix` fails because snapshots are incomplete:
     - missing `release.version`
     - missing `release.root`
     - missing `audit.seqTo`

## Findings (positive signals)

- `GET /healthz` returns `200`.
- With valid gateway token, `/template/call` enforcement behavior is mostly correct:
  - read action accepted (`404` valid upstream-shaped response),
  - unknown action blocked (`403`),
  - content-type guard active (`400 invalid_json`),
  - metrics bearer protection active (`200` with bearer).

## Required next actions

1. Deploy the latest hardened gateway runtime to VPS and repeat this exact probe set.
2. Verify `/template/config` returns hardened JSON contract (not `Gateway skeleton`).
3. Verify strict query guard behavior on `/template/config` and `/template/call`.
4. Re-run strict release drill and confirm integrity snapshot fields are complete (`release.version`, `release.root`, `audit.seqTo`).
