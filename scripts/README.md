# Scripts

Operator and test helpers live here. Keep them dependency-light, explicit, and safe to run from a shell.

## Worker-routing and secret-boundary helpers

- `scripts/check-template-worker-routing-config.js` validates tenant URL/token routing maps before they are published.
- `scripts/init-template-worker-routing.js` scaffolds a new routing map for a site set.
- `scripts/check-template-worker-map-coherence.js` cross-checks the URL, token, and signature-ref maps so missing or extra keys are visible before publish; use `--require-token-map` / `--require-signature-map` when you want those gaps to fail closed.
- `scripts/check-template-signature-ref-map.js` validates `GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP` before release signoff so every required site has a non-empty signature ref.
- `scripts/check-forget-forward-config.js` validates the optional forget-forward relay boundary (`GATEWAY_FORGET_FORWARD_URL`, `GATEWAY_FORGET_FORWARD_TOKEN`, `GATEWAY_FORGET_FORWARD_TIMEOUT_MS`) before enabling per-site forwarding.
- `npm run ops:validate-worker-secrets-trust-model` is the machine-check companion for `ops/worker-secrets-trust-model.md`; keep it CI-gated once the script is wired in.

Usage:
```bash
npm run ops:check-template-signature-ref-map -- --json
npm run ops:check-template-signature-ref-map -- --require-sites alpha,beta --strict
GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP='{"alpha":"sig-alpha","beta":"sig-beta"}' \
  node scripts/check-template-signature-ref-map.js --require-sites alpha,beta --json

npm run ops:check-template-worker-map-coherence -- --json
npm run ops:check-template-worker-map-coherence -- --require-sites alpha,beta --strict --require-token-map --require-signature-map
GATEWAY_TEMPLATE_WORKER_URL_MAP='{"alpha":"https://worker-a.example/sign","beta":"https://worker-b.example/sign"}' \
GATEWAY_TEMPLATE_WORKER_TOKEN_MAP='{"alpha":"token-alpha","beta":"token-beta"}' \
GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP='{"alpha":"sig-alpha","beta":"sig-beta"}' \
  node scripts/check-template-worker-map-coherence.js --json

npm run ops:check-forget-forward-config -- --json
GATEWAY_FORGET_FORWARD_URL='https://worker.example/cache/forget' \
  GATEWAY_FORGET_FORWARD_TOKEN='forward-secret' \
  GATEWAY_FORGET_FORWARD_TIMEOUT_MS=5000 \
  node scripts/check-forget-forward-config.js --strict
```

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
[integrity-gate] SUCCESS <N>/<N> checks passed
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
- CI runs this gate in its own dedicated `Integrity gate` job, separate from the core `build + full tests` job, so the final `SUCCESS 19/19 checks passed` line is easy to find in logs.

## Signoff record validator

`scripts/validate-signoff-record.js` checks `kernel-migration/SIGNOFF_RECORD.md` for the required closeout sections, tables, and decision metadata. It also supports strict placeholder detection so final signoff can fail closed if the template was not fully filled in.

Usage:
```bash
node scripts/validate-signoff-record.js
node scripts/validate-signoff-record.js --file kernel-migration/SIGNOFF_RECORD.md --json
node scripts/validate-signoff-record.js --strict
```

Notes:
- the default target is `kernel-migration/SIGNOFF_RECORD.md`
- human output prints a short status summary plus any blockers
- JSON output is deterministic and includes the parsed section presence map and blockers
- exit codes are `0` for success, `3` for blockers, and `64` for usage or file access errors

## Consistency preflight

`scripts/validate-consistency-preflight.js` checks a gateway URL set before a matrix compare or release drill. It validates URL syntax, mode/profile selection, and token or anonymous access rules.

Usage:
```bash
npm run ops:validate-consistency-preflight -- \
  --urls https://gateway-a.example.com,https://gateway-b.example.com \
  --mode pairwise --profile wedos_medium --allow-anon
```

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

## Integrity matrix comparison

`scripts/compare-integrity-matrix.js` extends consistency checks with two strategies:

- `pairwise` (default): adjacent gateway checks `(1,2), (2,3), ...`
- `all`: one combined matrix across all supplied URLs

Exit codes:
- `0` all runs pass
- `3` one or more field mismatches
- `2` fetch/payload failure
- `64` usage/configuration error

Usage:
```bash
GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \
  node scripts/compare-integrity-matrix.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com \
    --url https://gateway-c.example.com \
    --mode pairwise

npm run ops:compare-integrity-matrix -- \
  --url https://gateway-a.example.com \
  --url https://gateway-b.example.com \
  --mode all --json
```

## Multi-region drift alert summary

`scripts/build-drift-alert-summary.js` converts matrix JSON into a compact drift report with profile-aware alert guidance.

Usage:
```bash
node scripts/build-drift-alert-summary.js \
  --matrix ./tmp/consistency-matrix.json \
  --profile wedos_medium \
  --out ./tmp/consistency-drift-report.md \
  --json-out ./tmp/consistency-drift-summary.json

npm run ops:build-drift-alert-summary -- \
  --matrix ./tmp/consistency-matrix.json \
  --profile diskless \
  --json
```

## Consistency export report

`scripts/export-consistency-report.js` turns a matrix JSON file into a markdown drift report plus a JSON summary.

Usage:
```bash
npm run ops:export-consistency-report -- \
  --matrix ./tmp/consistency-matrix.json \
  --out-dir ./tmp/consistency-report
```

## AO dependency gate validation

`scripts/validate-ao-dependency-gate.js` checks `kernel-migration/ao-dependency-gate.json` before release gating. It verifies the required checks, allowed statuses, and evidence links for closed items.

Usage:
```bash
npm run ops:validate-ao-dependency-gate -- \
  --file kernel-migration/ao-dependency-gate.json
```

## Template backend contract validation

`scripts/validate-template-backend-contract.js` checks `config/template-backend-contract.json` for shape sanity on top of the JSON schema file. It verifies:

- action names are unique
- each action has a non-empty method and a non-empty path that starts with `/`
- method + path pairs are unique across the contract
- `forbiddenCapabilities` is non-empty and contains no duplicates

Usage:
```bash
npm run ops:validate-template-backend-contract
npm run ops:validate-template-backend-contract -- --strict
npm run ops:validate-template-backend-contract -- --file ./config/template-backend-contract.json --json
```

Exit codes:
- `0` validation passed, or issues were reported without `--strict`
- `3` validation issues found in `--strict` mode, or a runtime error occurred
- `64` usage error

## Final migration summary validation

`scripts/validate-final-migration-summary.js` checks `kernel-migration/FINAL_MIGRATION_SUMMARY.md` for the required headings, bullet fields, and evidence tables that close out the migration record.
In `--strict` mode it also rejects template placeholders such as `...`, `YYYY-...`, and the option-list guidance that should be replaced before release signoff.

Usage:
```bash
node scripts/validate-final-migration-summary.js --file kernel-migration/FINAL_MIGRATION_SUMMARY.md
node scripts/validate-final-migration-summary.js --file kernel-migration/FINAL_MIGRATION_SUMMARY.md --strict
node scripts/validate-final-migration-summary.js --file kernel-migration/FINAL_MIGRATION_SUMMARY.md --json
```

## Legacy import manifest validation

`scripts/validate-legacy-manifest.js` checks the imported legacy module inventory against `libs/legacy/MANIFEST.md`.
It parses the manifest table, verifies every listed module directory exists under `libs/legacy/<module>`, and confirms each module has `README.md`, `LICENSE`, and a `.import-source` file with a commit-ish marker.

Usage:
```bash
npm run ops:validate-legacy-manifest
npm run ops:validate-legacy-manifest -- --json
npm run ops:validate-legacy-manifest -- --manifest libs/legacy/MANIFEST.md --legacy-dir libs/legacy --strict
```

Exit codes:
- `0` validation passed, or issues were reported without `--strict`
- `3` validation issues found in `--strict` mode
- `64` usage error

## Legacy runtime boundary check

`scripts/check-legacy-runtime-boundary.js` scans runtime source files (default `src`) and reports import/require specifiers that reference `libs/legacy` directly or via path traversal.

Usage:
```bash
npm run ops:check-legacy-runtime-boundary
npm run ops:check-legacy-runtime-boundary -- --strict
npm run ops:check-legacy-runtime-boundary -- --root src --json
```

Exit codes:
- `0` pass, or findings without `--strict`
- `3` findings in `--strict` mode, or a runtime error occurred
- `64` usage error

## Legacy core extraction evidence

`scripts/check-legacy-core-extraction-evidence.js` machine-checks the blackcat-core extraction boundary by verifying required runtime files, required tests, and the absence of `libs/legacy/blackcat-core` references under `src/`.

Usage:
```bash
npm run ops:check-legacy-core-extraction-evidence
npm run ops:check-legacy-core-extraction-evidence -- --strict
npm run ops:check-legacy-core-extraction-evidence -- --root . --json
```

Exit codes:
- `0` evidence is complete, or issues were reported without `--strict`
- `3` evidence gaps found in `--strict` mode, or a runtime error occurred
- `64` usage error

## Legacy crypto boundary evidence

`scripts/check-legacy-crypto-boundary-evidence.js` machine-checks the blackcat-crypto boundary by verifying required runtime files/tests, the absence of `libs/legacy/blackcat-crypto` imports under `src/`, and verification-only runtime constraints (no wallet/private-key/signing capabilities in request-path crypto files).

Usage:
```bash
npm run ops:check-legacy-crypto-boundary-evidence
npm run ops:check-legacy-crypto-boundary-evidence -- --strict
npm run ops:check-legacy-crypto-boundary-evidence -- --root . --json
```

Exit codes:
- `0` evidence is complete, or issues were reported without `--strict`
- `3` evidence gaps found in `--strict` mode, or a runtime error occurred
- `64` usage error

## Mailing secret boundary check

`scripts/check-mailing-secret-boundary.js` scans `src/runtime/mailing/**` and fails when request-path mailing code reads local secrets (`process.env`, `import.meta.env`, or equivalent bindings).

Usage:
```bash
npm run ops:check-mailing-secret-boundary
npm run ops:check-mailing-secret-boundary -- --strict
npm run ops:check-mailing-secret-boundary -- --json
```

Exit codes:
- `0` pass, or findings without `--strict`
- `3` findings in `--strict` mode, or a runtime error occurred
- `64` usage error

## Legacy risk audit

`scripts/audit-legacy-risk.js` scans `libs/legacy` for high-risk patterns before runtime extraction.

It reports:
- JS/TS risk patterns (`eval`, `new Function`, `child_process` execution and shell mode)
- PHP risk patterns (`eval`, command execution functions, dynamic include/require paths)
- generic risk hints (private keys, bearer tokens, SQL string concatenation hints)

Usage:
```bash
npm run ops:audit-legacy-risk
npm run ops:audit-legacy-risk -- --strict
npm run ops:audit-legacy-risk -- --json > ./tmp/legacy-risk.json
```

Exit codes:
- `0` no critical findings in strict mode, or report generated in non-strict mode
- `3` strict mode with critical findings (or runtime scan failure)
- `64` usage error

## Legacy migration matrix build

`scripts/build-legacy-migration-matrix.js` generates a markdown matrix from `libs/legacy/MANIFEST.md`, optional risk JSON, and an optional machine-readable `blackcat-core` primitive map.

Usage:
```bash
npm run ops:build-legacy-migration-matrix
npm run ops:build-legacy-migration-matrix -- --risk ./tmp/legacy-risk.json
npm run ops:build-legacy-migration-matrix -- --core-map ./kernel-migration/core-primitive-map.json
npm run ops:build-legacy-migration-matrix -- --out ./kernel-migration/legacy-libs-matrix.md --json
```

## Legacy module-map sync check

`scripts/check-legacy-module-map-sync.js` ensures legacy module names stay synchronized across:

- `libs/legacy/MIGRATION_PLAN.md`
- `kernel-migration/LEGACY_MODULE_MAP.md`
- `kernel-migration/LEGACY_DECOMMISSION_CONDITIONS.md`

Usage:
```bash
npm run ops:check-legacy-module-map-sync -- --json
npm run ops:check-legacy-module-map-sync -- --strict
```

## Release evidence pack

`scripts/build-release-evidence-pack.js` merges consistency and evidence artifacts into a single release-ready summary (`markdown` + optional JSON) for sign-off.

It also picks up optional drill artifacts when they are present in the drill root (`--consistency-dir` in `scripts/run-release-drill.js`):
- `check-legacy-core-extraction-evidence.json`
- `check-legacy-crypto-boundary-evidence.json`
- `check-template-worker-map-coherence.json`
- `check-forget-forward-config.json`
- `check-template-signature-ref-map.json`

Missing optional artifacts are additive and do not block the pack. If either file exists but is not valid JSON, the pack is marked not-ready so the drill stops on a deterministic parse failure instead of silently ignoring it.

Usage:
```bash
node scripts/build-release-evidence-pack.js \
  --release 1.4.0 \
  --consistency-dir ./tmp/consistency-artifacts \
  --evidence-dir ./tmp/evidence-artifacts \
  --ao-gate-file ./kernel-migration/ao-dependency-gate.json \
  --out ./tmp/release-evidence-pack.md \
  --json-out ./tmp/release-evidence-pack.json \
  --require-both \
  --require-ao-gate

npm run ops:build-release-evidence-pack -- \
  --release 1.4.0 \
  --consistency-dir ./tmp/consistency-artifacts \
  --evidence-dir ./tmp/evidence-artifacts \
  --ao-gate-file ./kernel-migration/ao-dependency-gate.json \
  --json
```

## Release sign-off checklist

`scripts/build-release-signoff-checklist.js` renders a markdown checklist from a release pack and can fail strict when the pack is not ready.

Usage:
```bash
npm run ops:build-release-signoff-checklist -- \
  --pack ./artifacts/release-evidence-pack.json \
  --out ./artifacts/release-signoff-checklist.md \
  --strict
```

## Release readiness

`scripts/check-release-readiness.js` scores a release pack as `ready`, `warning`, or `blocked`, and can print JSON for automation.

Usage:
```bash
npm run ops:check-release-readiness -- \
  --pack ./artifacts/release-evidence-pack.json \
  --json
```

## One-shot release drill

`scripts/run-release-drill.js` orchestrates the full operator drill in one pass: preflight, matrix compare, report export, evidence bundle selection/validation, AO gate validation output, legacy core extraction evidence, legacy crypto boundary evidence, template worker map coherence validation, forget-forward config validation, template signature-ref map validation, release pack build, sign-off checklist, readiness JSON, release-drill manifest build, strict manifest validation output, strict artifact-set validation, and final release-evidence ledger generation.

The drill also writes a bundled metadata file, `release-drill-checks.json`, that captures the JSON outputs from the optional map/relay checks alongside the drill context. The template worker map coherence check runs strict only when at least one site key is configured in URL/token/signature maps; with no site mapping it stays informational. When `GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP` carries site keys, the signature-ref check runs strict and requires those keys; with an empty map it stays informational.

Usage:
```bash
npm run ops:run-release-drill -- \
  --urls https://gateway-a.example.com,https://gateway-b.example.com \
  --out-dir ./tmp/release-drill \
  --profile wedos_medium \
  --mode pairwise \
  --token "$GATEWAY_INTEGRITY_STATE_TOKEN" \
  --release 1.4.0 \
  --strict
```

The drill directory also contains `legacy-core-extraction-evidence.json`, `legacy-crypto-boundary-evidence.json`, `template-worker-map-coherence.json`, `forget-forward-config.json`, `template-signature-ref-map.json`, and `release-drill-checks.json` for downstream review and archiving.

## Release drill manifest build

`scripts/build-release-drill-manifest.js` assembles the release-drill manifest for a single drill run. It records resolved artifacts and status metadata so the run can be reviewed or replayed later.

Usage:
```bash
npm run ops:build-release-drill-manifest -- \
  --dir ./tmp/release-drill \
  --out ./tmp/release-drill/release-drill-manifest.json
```

## Release drill manifest validation

`scripts/validate-release-drill-manifest.js` checks a generated release-drill manifest before it is archived or used by downstream release steps.

Usage:
```bash
npm run ops:validate-release-drill-manifest -- \
  --file ./tmp/release-drill/release-drill-manifest.json \
  --strict
```

## Release drill artifact-set check

`scripts/check-release-drill-artifacts.js` validates that the drill directory contains the full mandatory artifact set and, in strict mode, verifies cross-file release consistency plus manifest-validation output.

The strict artifact set now includes `release-drill-checks.json` (drill context metadata), so `ops:run-release-drill` should be treated as the canonical producer before running the strict artifact checker.

Usage:
```bash
npm run ops:check-release-drill-artifacts -- \
  --dir ./tmp/release-drill \
  --strict \
  --json
```

## Release evidence ledger

`scripts/build-release-evidence-ledger.js` creates a final release ledger (`.md` + `.json`) from a completed drill directory, hashes archived artifacts, and derives an overall ready/blocked status.

Usage:
```bash
npm run ops:build-release-evidence-ledger -- \
  --dir ./tmp/release-drill \
  --decision pending \
  --strict
```

## Decommission evidence log

`scripts/build-decommission-evidence-log.js` creates the final decommission log (`.md` + `.json`) from a completed drill directory plus manual evidence links. It records timestamps, artifact presence, and the human proof links that are still required for decommission sign-off.

The log tracks these manual proof fields:

- recovery drill proof
- AO fallback proof
- rollback proof
- approvals / sign-off

Usage:
```bash
node scripts/build-decommission-evidence-log.js \
  --dir ./tmp/release-drill \
  --operator ops-user \
  --ticket GW-1234 \
  --decision pending \
  --recovery-drill-link https://example.com/recovery \
  --ao-fallback-link https://example.com/fallback \
  --rollback-proof-link https://example.com/rollback \
  --approvals-link https://example.com/approvals \
  --strict
```

Strict mode exits non-zero if any mandatory machine artifact is missing from the drill directory. The checker is part of the closeout sequence before readiness/signoff, so docs and logs should treat it as the AO/manual proof gate rather than a generic post-run cleanup step.

## Decommission manual-proof check

`scripts/check-decommission-manual-proofs.js` validates that `decommission-evidence-log.json` contains all required manual proof links:

- recovery drill proof
- AO fallback proof
- rollback proof
- approvals / sign-off

Usage:
```bash
npm run ops:check-decommission-manual-proofs -- \
  --file ./tmp/release-drill/decommission-evidence-log.json \
  --json \
  --strict
```

In non-strict mode, missing links return `pending` with exit code `0` so operators can track outstanding AO/manual work without breaking machine-only runs. In strict mode, missing proofs exit with code `3`.

## Decommission manual-proof scaffold

`scripts/init-decommission-manual-proofs.js` creates a JSON+Markdown scaffold for the required manual proof links before operators start filling decommission evidence.

Usage:
```bash
npm run ops:init-decommission-manual-proofs -- \
  --dir ./tmp/release-drill
```

Optional output overrides:
```bash
npm run ops:init-decommission-manual-proofs -- \
  --dir ./tmp/release-drill \
  --json-out ./tmp/release-drill/manual-proofs.json \
  --md-out ./tmp/release-drill/manual-proofs.md
```

Use `--force` only when intentionally regenerating files.

## AO gate evidence quality check

`scripts/check-ao-gate-evidence.js` validates the AO dependency gate for closeout quality (required IDs, status shape, evidence refs on closed checks, release/timestamp sanity).

Usage:
```bash
npm run ops:check-ao-gate-evidence -- \
  --file ./kernel-migration/ao-dependency-gate.json \
  --json

npm run ops:check-ao-gate-evidence -- \
  --file ./kernel-migration/ao-dependency-gate.json \
  --strict
```

## Decommission readiness check

`scripts/check-decommission-readiness.js` reads a completed drill directory + AO gate file and emits a blocker-oriented readiness summary with an explicit state split:

- `automationState`: machine artifact/drill readiness (`complete` or `blocked`)
- `aoManualState`: AO/manual proof readiness (`complete`, `pending`, or `blocked`)
- `closeoutState`: combined operator state (`ready`, `automation-blocked`, `ao-manual-pending`, `ao-manual-blocked`)

Usage:
```bash
npm run ops:check-decommission-readiness -- \
  --dir ./tmp/release-drill \
  --ao-gate ./kernel-migration/ao-dependency-gate.json \
  --strict \
  --json
```

## Decommission closeout one-shot

`scripts/run-decommission-closeout.js` is the final operator entrypoint for decommission closeout. It is intended to combine the machine checks, `check-decommission-manual-proofs`, evidence log generation, and AO-gate/readiness summaries into one run. The automation can complete while AO checks or manual proofs are still pending, so treat this as the closeout bundle step rather than the final approval itself.

By default it also validates:
- `kernel-migration/FINAL_MIGRATION_SUMMARY.md`
- `kernel-migration/SIGNOFF_RECORD.md`

Usage:
```bash
node scripts/run-decommission-closeout.js \
  --dir ./tmp/release-drill \
  --ao-gate ./kernel-migration/ao-dependency-gate.json \
  --final-summary ./kernel-migration/FINAL_MIGRATION_SUMMARY.md \
  --signoff-record ./kernel-migration/SIGNOFF_RECORD.md \
  --operator ops-user \
  --decision pending \
  --strict \
  --json
```

Failure triage:
- If the JSON summary still shows open AO checks, the automation is complete but the closeout is not yet decommission-ready.
- If the manual-proof fields are empty, fill in the recovery, fallback, rollback, and approvals links before retrying; if they are invalid, treat the result as `ao-manual-blocked`.
- If the drill artifacts are missing, re-run the release drill bundle and `check-decommission-readiness` first.

## Decommission closeout artifact validation

`scripts/validate-decommission-closeout.js` validates a generated closeout JSON artifact (`run-decommission-closeout --json`) and can enforce strict `ready` state in release gates.

Usage:
```bash
npm run ops:validate-decommission-closeout -- \
  --file ./tmp/release-drill/decommission-closeout.json \
  --json

npm run ops:validate-decommission-closeout -- \
  --file ./tmp/release-drill/decommission-closeout.json \
  --strict
```

## WEDOS readiness validator

`scripts/validate-wedos-readiness.js` validates constrained-hosting env settings against `wedos_small`, `wedos_medium`, or `diskless` budget envelopes.

Usage:
```bash
npm run ops:validate-wedos-readiness -- \
  --profile wedos_small \
  --env-file ./.env.wedos \
  --strict
```

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

## Integrity attestation validation

`scripts/validate-integrity-attestation.js` validates a generated attestation artifact and re-checks its digest before archival or operator sign-off.

Usage:
```bash
node scripts/validate-integrity-attestation.js --file ./artifacts/integrity-attestation.json
npm run ops:validate-integrity-attestation -- --file ./artifacts/integrity-attestation.json
```

## Evidence bundle check

`scripts/check-evidence-bundle.js` verifies a generated evidence bundle directory and re-runs attestation validation as part of the check.

Usage:
```bash
node scripts/check-evidence-bundle.js --dir ./artifacts/integrity-evidence/2026-04-10T12-34-56Z-1234-abcd12
npm run ops:check-evidence-bundle -- \
  --dir ./artifacts/integrity-evidence/2026-04-10T12-34-56Z-1234-abcd12 \
  --strict
```

`--strict` additionally requires:
- `manifest.status === "ok"`
- `manifest.compare.exitCode === 0`
- `manifest.attestation.exitCode === 0`

## Latest evidence bundle helper

`scripts/latest-evidence-bundle.js` selects the newest timestamped bundle directory under a root path and prints resolved artifact paths.

Usage:
```bash
node scripts/latest-evidence-bundle.js --root ./artifacts/integrity-evidence --require-files
npm run ops:latest-evidence-bundle -- --root ./artifacts/integrity-evidence --json --require-files
```

## Evidence bundle index helper

`scripts/index-evidence-bundles.js` scans timestamped evidence bundle directories and outputs a compact index (`json` or `csv`).

Usage:
```bash
node scripts/index-evidence-bundles.js \
  --root ./artifacts/integrity-evidence \
  --strict \
  --format json

npm run ops:index-evidence-bundles -- \
  --root ./artifacts/integrity-evidence \
  --format csv \
  --out ./artifacts/integrity-evidence/index.csv
```

## Attestation exchange pack helper

`scripts/build-attestation-exchange-pack.js` builds a portable bundle-of-bundles file for cross-gateway exchange/review.

Usage:
```bash
node scripts/build-attestation-exchange-pack.js \
  --bundle ./artifacts/integrity-evidence/2026-04-10T12-34-56Z-1234-abcd12 \
  --bundle ./artifacts/integrity-evidence/2026-04-11T12-00-01Z-5678-ef9012 \
  --out ./artifacts/integrity-evidence/attestation-exchange-pack.json

npm run ops:build-attestation-exchange-pack -- \
  --bundle ./artifacts/integrity-evidence/2026-04-10T12-34-56Z-1234-abcd12 \
  --out ./artifacts/integrity-evidence/attestation-exchange-pack.json \
  --include-compare-log
```

## Rate-limit override suggestion helper

`scripts/suggest-ratelimit-overrides.js` generates deterministic per-prefix `RATE_LIMIT_ROUTE_OVERRIDES` suggestions from route stats for `wedos_small`, `wedos_medium`, or `diskless` profiles.

Usage:
```bash
node scripts/suggest-ratelimit-overrides.js \
  --input ./tmp/rate-stats.json \
  --profile wedos_small \
  --floor 5 \
  --ceiling 120

npm run ops:suggest-ratelimit-overrides -- \
  --input ./tmp/rate-stats.json \
  --profile diskless
```

## Consistency smoke dispatch helper

`scripts/dispatch-consistency-smoke.js` sends a `workflow_dispatch` request to GitHub Actions for consistency/evidence smoke runs.

Usage:
```bash
GH_TOKEN="$GH_TOKEN" \
  node scripts/dispatch-consistency-smoke.js \
    --owner Vito416 \
    --repo blackcat-darkmesh-gateway \
    --workflow ci.yml \
    --ref main \
    --consistency-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --consistency-mode all \
    --consistency-profile wedos_medium \
    --consistency-token "$STATE_TOKEN" \
    --evidence-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --evidence-token "$STATE_TOKEN"

# Dry-run payload preview (no API call)
node scripts/dispatch-consistency-smoke.js \
  --owner Vito416 \
  --repo blackcat-darkmesh-gateway \
  --consistency-urls https://gateway-a.example.com,https://gateway-b.example.com \
  --evidence-urls https://gateway-a.example.com,https://gateway-b.example.com \
  --dry-run
```

## Other helpers

- `fetch-template.ts` — pull Arweave template, verify manifest signature.
- `psp-webhook-replay.ts` — replay stored webhook fixtures against local gateway.
- `cache-wipe.ts` — trigger ForgetSubject wipe for testing.

## Weekly consistency drill

Use the helpers below to verify the evidence chain once a week before promotion or release sign-off.

### 1) Resolve the latest bundle

```bash
node scripts/latest-evidence-bundle.js \
  --root ./artifacts/integrity-evidence \
  --require-files
```

Pass: the helper prints the newest bundle path plus `compare.txt`, `attestation.json`, and `manifest.json`, then exits `0`.

Fail: exit `3` means no bundle was found; any other non-zero exit means the bundle root or required files are invalid.

### 2) Check the bundle

```bash
node scripts/check-evidence-bundle.js \
  --dir ./artifacts/integrity-evidence/<timestamp> \
  --strict
```

Pass: the bundle manifest and attestation validate cleanly, then the helper exits `0`.

Fail: exit `3` means the bundle content does not line up; exit `64` means the command line or paths are invalid.

### 3) Index and package the evidence

```bash
node scripts/index-evidence-bundles.js \
  --root ./artifacts/integrity-evidence \
  --strict \
  --format json

node scripts/build-attestation-exchange-pack.js \
  --bundle ./artifacts/integrity-evidence/<timestamp> \
  --out ./artifacts/integrity-evidence/attestation-exchange-pack.json
```

Pass: index output contains expected bundle rows and exchange-pack generation exits `0`.

Fail: exits `3` when strict validation fails or bundle data is malformed; exits `64` on invalid CLI usage.

### 4) Dispatch the smoke

```bash
GH_TOKEN="$GH_TOKEN" \
  node scripts/dispatch-consistency-smoke.js \
    --owner Vito416 \
    --repo blackcat-darkmesh-gateway \
    --workflow ci.yml \
    --ref main \
    --consistency-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --consistency-token "$STATE_TOKEN" \
    --evidence-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --evidence-token "$STATE_TOKEN"
```

Pass: GitHub accepts the dispatch and the workflow picks up the supplied URLs.

Fail: the helper exits non-zero if `GH_TOKEN` / `GITHUB_TOKEN` is missing or the API rejects the request; use `--dry-run` first when checking a new payload.

Weekly drill env vars:
- `GATEWAY_INTEGRITY_STATE_TOKEN` for compare and validation flows
- `GATEWAY_ATTESTATION_HMAC_KEY` if the attestation should be signed
- `GH_TOKEN` or `GITHUB_TOKEN` for the workflow dispatch
