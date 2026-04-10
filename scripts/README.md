# Scripts

Operator and test helpers live here. Keep them dependency-light, explicit, and safe to run from a shell.

## Integrity incident helper

`scripts/integrity-incident.js` sends signed operator requests to the integrity endpoints:

- `pause`
- `resume`
- `ack`
- `report`
- `state`

It validates the action, URL, token source, and incident payload before calling `curl`, and prints the full response headers/body plus `HTTP_STATUS`.
Blank token values are rejected, and unknown flags fail immediately so accidental shell typos do not become silent no-ops.

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

## Integrity gate

`scripts/ci/integrity-gate.sh` is the fast-fail integrity test entry point used by CI and by local operator checks.
It runs build first, then executes the integrity-focused Vitest slices in a fixed order, and finishes with a single success summary line:

```text
[integrity-gate] SUCCESS 14/14 checks passed
```

Usage:
```bash
bash scripts/ci/integrity-gate.sh
npm run test:integrity-fast
npm run test:integrity-gate
```

Notes:
- The gate checks `npm` and `npx` up front and fails with a clear message if either is unavailable.
- Output is step-oriented (`>>> step`, `<<< step [ok]`) so the first failing slice is easy to spot.
- The gate stops on the first failure and prints the failing step name in the error line.
- CI runs this gate in its own dedicated `Integrity gate` job, separate from the core `build + full tests` job, so the final `SUCCESS 14/14 checks passed` line is easy to find in logs.

## Integrity incident smoke

`scripts/e2e-integrity-incident-smoke.js` runs a practical pause/resume smoke flow against a gateway:

1. reads `/integrity/state`
2. pauses the gateway through `/integrity/incident`
3. verifies a write action on `/template/call` returns the paused envelope
4. resumes the gateway
5. reads `/integrity/state` again

The helper prints explicit `[PASS]` / `[FAIL]` checkpoints, exits with `0` only when the full flow succeeds, and exits non-zero on any validation, request, or cleanup failure.
It also restores the original pause state best-effort at the end.
The blocked mutable check uses `checkout.create-order` with a minimal payload, which matches the gateway's current write policy.
The last log line is a compact CI-friendly summary in the form `[SMOKE] PASS ...` or `[SMOKE] FAIL step=... code=...`.
Validation is strict:
- `--base-url` and `GATEWAY_BASE_URL` must be non-empty `http`/`https` URLs
- `--timeout-ms` and `GATEWAY_SMOKE_TIMEOUT_MS` must be positive integers when set, and default to `5000`
- token flags/env vars are optional, but if provided they must not be blank

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

npm run smoke:integrity-incident
```

Tip:
- If you only want to validate CLI parsing and help output, `--help` exits immediately without touching the network.
- The helper prints a final `[SMOKE] PASS incident control smoke completed` line only after pause, blocked write, resume, and cleanup have all passed.
- In CI, the incident smoke job is optional: it runs automatically only when the needed secrets are present, and it can also be triggered manually with `workflow_dispatch` inputs.

## Integrity state comparison

`scripts/compare-integrity-state.js` fetches `/integrity/state` from multiple gateways and compares the release/policy/audit fields that should stay in lockstep during attestation bootstrap:

- `policy.paused`
- `policy.activeRoot`
- `policy.activePolicyHash`
- `release.version`
- `release.root`
- `audit.seqTo`

It prints a compact per-field consensus table and exits with:

- `0` when all compared fields match
- `3` when one or more fields mismatch
- `2` when a request fails or a gateway returns an invalid state payload
- `64` when arguments or token configuration are invalid

Usage:
```bash
GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \
  node scripts/compare-integrity-state.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com

node scripts/compare-integrity-state.js \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com \
  --token token-a \
  --token token-b

npm run ops:compare-integrity -- \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com
```

Token handling:
- pass one `--token` to reuse the same state token for every URL
- pass one `--token` per `--url` to compare gateways with different tokens
- if no `--token` is given, the helper falls back to `GATEWAY_INTEGRITY_STATE_TOKEN`
- blank tokens are rejected so auth mistakes fail fast

## Integrity attestation artifact

`scripts/generate-integrity-attestation.js` fetches `/integrity/state` from multiple gateways, compares the attestation bootstrap fields, and writes a compact JSON artifact that you can archive with a release or incident bundle.

The artifact includes:

- the gateway URLs and raw snapshots
- the compared field matrix
- a timestamp
- a stable script version tag
- a deterministic `sha256` digest over the canonical JSON segment
- an optional `hmacSha256` field when `--hmac-env` points to a populated secret

Exit codes mirror the compare helper:

- `0` when all compared fields match
- `2` when a request fails or a snapshot is incomplete
- `3` when one or more compared fields mismatch

Usage:
```bash
GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \
  node scripts/generate-integrity-attestation.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com \
    --out ./artifacts/integrity-attestation.json

node scripts/generate-integrity-attestation.js \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com \
  --token token-a \
  --token token-b \
  --out ./artifacts/integrity-attestation.json \
  --hmac-env GATEWAY_ATTESTATION_HMAC_KEY

npm run ops:attest-integrity -- \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com \
  --out ./artifacts/integrity-attestation.json
```

Archive tip:
- keep the generated JSON alongside the release notes, operator notes, or incident bundle so the exact comparison input stays reviewable later.
- if `hmacSha256` is present, store the signing secret separately from the artifact and rotate it on the same cadence as the attestation bootstrap workflow.

## Integrity evidence bundle

`scripts/export-integrity-evidence.js` runs the compare helper and attestation generator back-to-back, then stores both outputs in a timestamped subdirectory under the chosen export root.

The bundle contains:

- `compare.txt` with the command summaries, exit codes, stdout, and stderr for both helper runs
- `attestation.json` with the generated artifact
- `manifest.json` with timestamps, URL list, redacted command-summary data, and result statuses

Exit behavior:

- the command exits `0` only when both helper runs succeed
- if compare fails, the export exits with the compare code after still writing the bundle metadata
- if attestation fails, the export exits non-zero after writing the compare log and manifest

Usage:
```bash
GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \
  node scripts/export-integrity-evidence.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com \
    --out-dir ./artifacts/integrity-evidence

node scripts/export-integrity-evidence.js \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com \
  --token token-a \
  --token token-b \
  --out-dir ./artifacts/integrity-evidence \
  --hmac-env GATEWAY_ATTESTATION_HMAC_KEY

npm run ops:export-integrity-evidence -- \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com \
  --out-dir ./artifacts/integrity-evidence
```

## Other helpers

- `fetch-template.ts` — pull Arweave template, verify manifest signature.
- `psp-webhook-replay.ts` — replay stored webhook fixtures against local gateway.
- `cache-wipe.ts` — trigger ForgetSubject wipe for testing.
