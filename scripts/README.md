# Scripts

Operator and test helpers live here. Keep them dependency-light and safe to run from a shell.

## Integrity incident helper

`scripts/integrity-incident.js` sends signed operator requests to the integrity endpoints:

- `pause`
- `resume`
- `ack`
- `report`
- `state`

It validates the action, URL, token source, and incident payload before calling `curl`, and prints the full response headers/body plus `HTTP_STATUS`.

Usage:
```bash
node scripts/integrity-incident.js pause --url http://localhost:8787
node scripts/integrity-incident.js report --url https://gateway.example.com --severity high --event integrity-spike
node scripts/integrity-incident.js state --url https://gateway.example.com
```

Auth token handling:
- incident actions default to `GATEWAY_INTEGRITY_INCIDENT_TOKEN`
- `state` defaults to `GATEWAY_INTEGRITY_STATE_TOKEN`
- override with `--token-env NAME` or `--token VALUE`
- prefer environment variables in staging/prod; avoid putting secrets directly on the shell line

Examples:
```bash
GATEWAY_INTEGRITY_INCIDENT_TOKEN=dev-secret \
  node scripts/integrity-incident.js pause --url http://localhost:8787

GATEWAY_INTEGRITY_INCIDENT_TOKEN=prod-secret \
  node scripts/integrity-incident.js ack --url https://gateway.example.com \
    --signature-ref sig-emergency-v2 --incident-id inc-2026-04-09

GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \
  node scripts/integrity-incident.js state --url https://gateway.example.com
```

## Integrity incident smoke

`scripts/e2e-integrity-incident-smoke.js` runs a practical pause/resume smoke flow against a gateway:

1. reads `/integrity/state`
2. pauses the gateway through `/integrity/incident`
3. verifies a write action on `/template/call` returns the paused envelope
4. resumes the gateway
5. reads `/integrity/state` again

The helper prints explicit `[PASS]` / `[FAIL]` checkpoints and exits non-zero on failure. It also restores the original pause state best-effort at the end.
The blocked mutable check uses `checkout.create-order` with a minimal payload, which matches the gateway's current write policy.

Required configuration:
- `GATEWAY_BASE_URL` or `--base-url`

Optional auth/env overrides:
- `GATEWAY_INTEGRITY_STATE_TOKEN` or `--state-token`
- `GATEWAY_INTEGRITY_INCIDENT_TOKEN` or `--incident-token`
- `GATEWAY_TEMPLATE_TOKEN` or `--template-token`
- `GATEWAY_SMOKE_TIMEOUT_MS` or `--timeout-ms`

Usage:
```bash
GATEWAY_BASE_URL=http://localhost:8787 \
GATEWAY_INTEGRITY_INCIDENT_TOKEN=incident-secret \
GATEWAY_TEMPLATE_TOKEN=tmpl-secret \
  node scripts/e2e-integrity-incident-smoke.js

node scripts/e2e-integrity-incident-smoke.js \
  --base-url https://gateway.example.com \
  --state-token state-secret \
  --incident-token incident-secret \
  --template-token tmpl-secret
```

## Other helpers

- `fetch-template.ts` — pull Arweave template, verify manifest signature.
- `psp-webhook-replay.ts` — replay stored webhook fixtures against local gateway.
- `cache-wipe.ts` — trigger ForgetSubject wipe for testing.
