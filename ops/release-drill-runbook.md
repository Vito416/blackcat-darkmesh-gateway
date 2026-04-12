# Gateway Release Drill Runbook

Use this runbook before a release PR merge or staging promotion to verify gateway consistency, export evidence, and produce the final sign-off pack.

## Fast path (one-shot orchestration)

Use this when you want one command to run the full drill end-to-end and write canonical artifacts.

```bash
npm run ops:run-release-drill -- \
  --urls "$CONSISTENCY_URLS" \
  --out-dir "$DRILL_DIR" \
  --profile "$GATEWAY_RESOURCE_PROFILE" \
  --mode pairwise \
  --token "$GATEWAY_INTEGRITY_STATE_TOKEN" \
  --release "$RELEASE_VERSION" \
  --strict
```

This command generates:
- `consistency-matrix.json`
- `consistency-drift-report.md`
- `consistency-drift-summary.json`
- `latest-evidence-bundle.json`
- `release-evidence-pack.md`
- `release-evidence-pack.json`
- `release-signoff-checklist.md`
- `release-readiness.json`

## Prerequisites

- Repo root: `blackcat-darkmesh-gateway`
- Writable artifact directory, for example `./tmp/release-drill`
- At least two gateway base URLs
- Deployment profile: `wedos_small`, `wedos_medium`, or `diskless` (`wedos_medium` is the default)
- Integrity state token: `GATEWAY_INTEGRITY_STATE_TOKEN`
- Optional attestation HMAC env: `GATEWAY_ATTESTATION_HMAC_KEY`
- AO dependency gate file: `ops/decommission/ao-dependency-gate.json`
- Optional public-state mode: use `--allow-anon` only when the `/integrity/state` endpoint is intentionally public

Suggested shell setup:

```bash
export GW_A_URL="https://gateway-a.example.com"
export GW_B_URL="https://gateway-b.example.com"
export CONSISTENCY_URLS="$GW_A_URL,$GW_B_URL"
export GATEWAY_RESOURCE_PROFILE="wedos_medium"
export GATEWAY_INTEGRITY_STATE_TOKEN="replace-me"
export GATEWAY_ATTESTATION_HMAC_KEY="replace-me"
export RELEASE_VERSION="1.4.0"
export DRILL_DIR="./tmp/release-drill"
mkdir -p "$DRILL_DIR"
```

## 1) Validate the preflight

Confirm the URLs, profile, and auth mode before you spend time on the full drill.

```bash
npm run ops:validate-consistency-preflight -- \
  --urls "$CONSISTENCY_URLS" \
  --mode pairwise \
  --profile "$GATEWAY_RESOURCE_PROFILE" \
  --token "$GATEWAY_INTEGRITY_STATE_TOKEN"
```

Expected output:
- `Consistency preflight passed`
- Exit code `0`

Artifacts:
- None

If the state endpoint is public, replace `--token ...` with `--allow-anon`.

## 2) Compare the integrity matrix

Generate the machine-readable matrix used by the rest of the drill.

```bash
npm run ops:compare-integrity-matrix -- \
  --url "$GW_A_URL" \
  --url "$GW_B_URL" \
  --mode pairwise \
  --json > "$DRILL_DIR/consistency-matrix.json"
```

Expected output:
- JSON with `counts.total`, `counts.pass`, `counts.mismatch`, `counts.failure`, and `exitCode`
- Exit code `0` on full match, `3` on mismatch, `2` on fetch/runtime failure

Artifacts:
- `$DRILL_DIR/consistency-matrix.json`

## 3) Export the consistency report

Turn the matrix into a profile-aware drift report for review.

```bash
npm run ops:export-consistency-report -- \
  --matrix "$DRILL_DIR/consistency-matrix.json" \
  --out-dir "$DRILL_DIR/consistency" \
  --profile "$GATEWAY_RESOURCE_PROFILE"
```

Expected output:
- `consistency-drift-report.md`
- `consistency-drift-summary.json`
- Exit code `0`

Artifacts:
- `$DRILL_DIR/consistency/consistency-drift-report.md`
- `$DRILL_DIR/consistency/consistency-drift-summary.json`

## 4) Export the integrity evidence bundle

Capture the compare and attestation evidence in a timestamped bundle.

```bash
npm run ops:export-integrity-evidence -- \
  --url "$GW_A_URL" \
  --url "$GW_B_URL" \
  --out-dir "$DRILL_DIR/evidence" \
  --hmac-env GATEWAY_ATTESTATION_HMAC_KEY
```

Expected output:
- Bundle directory named like `2026-04-11T10-15-30Z-12345-abc123`
- `compare.txt`, `attestation.json`, and `manifest.json` inside the bundle
- Exit code mirrors the failing child script, if any

Artifacts:
- `$DRILL_DIR/evidence/<timestamped-bundle>/compare.txt`
- `$DRILL_DIR/evidence/<timestamped-bundle>/attestation.json`
- `$DRILL_DIR/evidence/<timestamped-bundle>/manifest.json`

If this step fails, inspect `compare.txt` first because it records both child command outputs.

## 5) Validate the latest evidence bundle

Make sure the timestamped evidence bundle is present and valid before you feed it to the release pack.

```bash
LATEST_BUNDLE="$(npm run --silent ops:latest-evidence-bundle -- --root "$DRILL_DIR/evidence" --require-files | awk -F': ' '/^bundleDir:/ {print $2; exit}')"
npm run --silent ops:check-evidence-bundle -- --dir "$LATEST_BUNDLE" --strict
```

Expected output:
- `valid evidence bundle: <bundle-dir> (strict)`
- Exit code `0`

Artifacts:
- None

## 6) Validate the AO dependency gate

Make sure the release gate file is structurally valid and all required checks are closed.

```bash
AO_GATE_VALIDATE="$DRILL_DIR/ao-dependency-gate.validation.txt"
npm run ops:validate-ao-dependency-gate -- \
  --file ops/decommission/ao-dependency-gate.json | tee "$AO_GATE_VALIDATE"
```

Expected output:
- `valid dependency gate: ops/decommission/ao-dependency-gate.json`
- Exit code `0`

Artifacts:
- `$DRILL_DIR/ao-dependency-gate.validation.txt`

## 7) Build the release evidence pack

Combine consistency, evidence, and AO gate results into one release-ready pack.

```bash
npm run ops:build-release-evidence-pack -- \
  --release "$RELEASE_VERSION" \
  --consistency-dir "$DRILL_DIR" \
  --evidence-dir "$DRILL_DIR/evidence" \
  --ao-gate-file ops/decommission/ao-dependency-gate.json \
  --require-both \
  --require-ao-gate \
  --out "$DRILL_DIR/release-evidence-pack.md" \
  --json-out "$DRILL_DIR/release-evidence-pack.json"
```

Expected output:
- Markdown pack with sections for consistency, evidence bundle, AO gate, blockers, and warnings
- JSON pack with `status`, `blockers`, `warnings`, `consistency`, `evidence`, and `aoGate`
- Exit code `0` when ready, `3` when not-ready

Artifacts:
- `$DRILL_DIR/release-evidence-pack.md`
- `$DRILL_DIR/release-evidence-pack.json`

## 8) Generate the sign-off checklist

Produce the human checklist that mirrors the release pack state.

```bash
npm run ops:build-release-signoff-checklist -- \
  --pack "$DRILL_DIR/release-evidence-pack.json" \
  --out "$DRILL_DIR/release-signoff-checklist.md" \
  --strict
```

Expected output:
- Markdown checklist with status, blockers, warnings, and sign-off items
- Exit code `0` only when the pack status is `ready`

Artifacts:
- `$DRILL_DIR/release-signoff-checklist.md`

## 9) Check release readiness

Use the readiness evaluator as the final machine check before sign-off.

```bash
READINESS_JSON="$DRILL_DIR/release-readiness.json"
npm run ops:check-release-readiness -- \
  --pack "$DRILL_DIR/release-evidence-pack.json" \
  --strict \
  --json | tee "$READINESS_JSON"
```

Expected output:
- JSON with `status`, `blockerCount`, `warningCount`, and `release`
- Exit code `0` only when readiness is `ready`

Artifacts:
- `$DRILL_DIR/release-readiness.json`

## 10) Build and validate the drill manifest

Create the release-drill manifest from the drill artifact directory, validate it in strict mode, and archive both the JSON and validation output.

```bash
ARCHIVE_MANIFEST="$DRILL_DIR/release-drill-manifest.json"
ARCHIVE_MANIFEST_VALIDATE="$DRILL_DIR/release-drill-manifest.validation.txt"

npm run ops:build-release-drill-manifest -- \
  --dir "$DRILL_DIR" \
  --out "$ARCHIVE_MANIFEST"

npm run ops:validate-release-drill-manifest -- \
  --file "$ARCHIVE_MANIFEST" \
  --strict | tee "$ARCHIVE_MANIFEST_VALIDATE"
```

Expected output:
- JSON manifest written to `$DRILL_DIR/release-drill-manifest.json`
- Strict validation output written to `$DRILL_DIR/release-drill-manifest.validation.txt`
- Both commands exit `0`

Artifacts:
- `$DRILL_DIR/release-drill-manifest.json`
- `$DRILL_DIR/release-drill-manifest.validation.txt`

## 11) Check drill artifact completeness (strict)

Run the strict artifact-set checker to ensure the release-drill directory is complete and internally consistent.

```bash
DRILL_CHECK_JSON="$DRILL_DIR/release-drill-check.json"
npm run ops:check-release-drill-artifacts -- \
  --dir "$DRILL_DIR" \
  --strict \
  --json > "$DRILL_CHECK_JSON"
```

Expected output:
- JSON check result written to `$DRILL_DIR/release-drill-check.json`
- Metadata context file present at `$DRILL_DIR/release-drill-checks.json` (generated by `ops:run-release-drill`)
- Strict check confirms legacy crypto/core evidence artifacts are present (`legacy-core-extraction-evidence.json`, `legacy-crypto-boundary-evidence.json`)
- Exit code `0`

Artifacts:
- `$DRILL_DIR/release-drill-check.json`
- `$DRILL_DIR/release-drill-checks.json`
- `$DRILL_DIR/legacy-core-extraction-evidence.json`
- `$DRILL_DIR/legacy-crypto-boundary-evidence.json`

## 12) Build release evidence ledger

Generate the final machine-readable release ledger from the completed drill directory.

```bash
LEDGER_MD="$DRILL_DIR/release-evidence-ledger.md"
LEDGER_JSON="$DRILL_DIR/release-evidence-ledger.json"

npm run ops:build-release-evidence-ledger -- \
  --dir "$DRILL_DIR" \
  --decision pending \
  --out "$LEDGER_MD" \
  --json-out "$LEDGER_JSON" \
  --strict
```

Expected output:
- `release-evidence-ledger.md` and `release-evidence-ledger.json` are written
- JSON includes `overallStatus`, per-check booleans, and SHA-256 hashes for archived artifacts
- Exit code `0` only when strict ledger checks resolve to `ready`

Artifacts:
- `$DRILL_DIR/release-evidence-ledger.md`
- `$DRILL_DIR/release-evidence-ledger.json`

## 13) Check decommission readiness

Use the final machine summary before archive or deletion work. This reads the completed drill artifacts plus the AO gate file and reports blockers in a compact form.

```bash
npm run ops:check-decommission-readiness -- \
  --dir "$DRILL_DIR" \
  --ao-gate ops/decommission/ao-dependency-gate.json \
  --strict \
  --json
```

Expected output:
- JSON summary with `status`, `blockers`, and per-artifact / AO gate checks
- Exit code `0` only when the drill artifacts are ready and all required AO gate checks are closed

Artifacts:
- none

## 14) Run the decommission closeout one-shot

Use the final closeout orchestrator after the drill bundle is complete. This step automates the machine checks and evidence-log assembly, but it does **not** close the AO gate by itself and it does **not** replace the remaining manual proofs.

```bash
node scripts/run-decommission-closeout.js \
  --dir "$DRILL_DIR" \
  --ao-gate ops/decommission/ao-dependency-gate.json \
  --operator "$OPERATOR_NAME" \
  --decision pending \
  --strict \
  --json
```

Expected output:
- JSON closeout summary with AO gate status, readiness blockers, and manual-proof fields
- `decommission-evidence-log.md` and `decommission-evidence-log.json` written into the drill directory
- Exit code `0` only when the machine checks are clean; AO/manual proofs may still remain open

Artifacts:
- `$DRILL_DIR/decommission-evidence-log.md`
- `$DRILL_DIR/decommission-evidence-log.json`

Notes:
- If the AO gate still has open required checks, treat the result as automation-complete-but-not-decommission-ready.
- Manual evidence is still required for recovery drill proof, AO fallback proof, rollback proof, and stakeholder approval.

## Failure triage matrix

| Failing script | Likely cause | First check |
| --- | --- | --- |
| `ops:validate-consistency-preflight` | Bad URL list, missing token, unsupported profile, or anonymous access not allowed | Re-check `CONSISTENCY_URLS`, `GATEWAY_RESOURCE_PROFILE`, and the state auth mode |
| `ops:compare-integrity-matrix` exit `2` | Network, DNS, TLS, 401/403, or invalid `/integrity/state` response | Hit each state URL directly with the same token and inspect the HTTP body |
| `ops:compare-integrity-matrix` exit `3` | Legitimate drift or incomplete snapshots | Compare the differing fields in the JSON output before widening any thresholds |
| `ops:export-consistency-report` | Matrix JSON missing, unreadable, or profile mismatch | Confirm the matrix file exists and the profile matches the deployment tier |
| `ops:export-integrity-evidence` | Child compare or attestation script failed; token/HMAC mismatch is the common cause | Open the bundle `compare.txt` and check the recorded child exit codes |
| `ops:latest-evidence-bundle` | No timestamped bundle exists yet, or the bundle root points at the wrong directory | Confirm `ops:export-integrity-evidence` wrote a bundle under `$DRILL_DIR/evidence` |
| `ops:check-evidence-bundle` | Bundle files are missing, the manifest is malformed, or attestation validation failed | Open `manifest.json` and `attestation.json` in the latest bundle |
| `ops:validate-ao-dependency-gate` | Gate JSON malformed or a required AO check is not closed | Inspect `required` versus `checks` in `ops/decommission/ao-dependency-gate.json`, then check `ao-dependency-gate.validation.txt` |
| `ops:build-release-evidence-pack` | Missing consistency evidence, missing evidence bundle, or an AO gate that is not closed | Verify the latest bundle directory and the release pack status fields |
| `ops:build-release-signoff-checklist` | Pack JSON missing, unreadable, or not `ready` under `--strict` | Read the pack blockers and warnings before retrying |
| `ops:check-release-readiness` | Pack contains blockers, or warnings remain under strict mode | Inspect `blockers` and `warnings` in `release-evidence-pack.json` |
| `ops:build-release-drill-manifest` | Drill artifact directory is incomplete or release/status cannot be derived | Verify all required drill artifacts exist in `$DRILL_DIR` |
| `ops:validate-release-drill-manifest` | Manifest schema/content mismatch in strict mode | Inspect path uniqueness, sha256 format/casing, and artifact metadata |
| `ops:check-release-drill-artifacts` | Required drill artifacts are missing or release metadata is inconsistent across files | Inspect `release-drill-check.json` and `release-drill-checks.json`, then compare pack/readiness/manifest release fields and validation log |
| `ops:build-release-evidence-ledger` | Final archive set is present but one or more strict ledger checks are not `ready` | Inspect `release-evidence-ledger.json` check flags and re-validate AO gate/manifest/readiness outputs |
| `ops:check-decommission-readiness` | Final archive set or AO gate is not ready for decommission | Inspect the JSON blockers list; it names the missing artifacts, non-ready statuses, and open AO checks directly |
| `ops:run-decommission-closeout` | AO gate is still open, required drill artifacts are missing, or manual-proof links are not supplied yet | Inspect the JSON summary, then re-run `ops:check-decommission-readiness` and `ops:check-ao-gate-evidence` before filling the manual-proof fields |

## Final sign-off mapping

| Sign-off item | Source command | Evidence to attach |
| --- | --- | --- |
| Confirm consistency is acceptable | `ops:validate-consistency-preflight`, `ops:compare-integrity-matrix`, `ops:export-consistency-report` | `consistency-matrix.json`, `consistency-drift-report.md`, `consistency-drift-summary.json` |
| Confirm evidence bundle is acceptable | `ops:export-integrity-evidence`, `ops:latest-evidence-bundle`, `ops:check-evidence-bundle` | Timestamped bundle containing `compare.txt`, `attestation.json`, and `manifest.json` |
| Confirm AO dependency gate is acceptable | `ops:validate-ao-dependency-gate` | `ops/decommission/ao-dependency-gate.json` with all required checks closed + `$DRILL_DIR/ao-dependency-gate.validation.txt` |
| Confirm archive manifest is acceptable | `ops:build-release-drill-manifest`, `ops:validate-release-drill-manifest` | `$DRILL_DIR/release-drill-manifest.json` and `$DRILL_DIR/release-drill-manifest.validation.txt` |
| Confirm drill artifact completeness is acceptable | `ops:check-release-drill-artifacts` | `$DRILL_DIR/release-drill-check.json`, `$DRILL_DIR/release-drill-checks.json` |
| Confirm final machine ledger is acceptable | `ops:build-release-evidence-ledger` | `$DRILL_DIR/release-evidence-ledger.md`, `$DRILL_DIR/release-evidence-ledger.json` |
| Review blockers and warnings | `ops:build-release-evidence-pack`, `ops:check-release-readiness` | `release-evidence-pack.md`, `release-evidence-pack.json`, readiness output, and drill manifest artifacts |
| Produce the operator checklist | `ops:build-release-signoff-checklist` | `release-signoff-checklist.md` |

## Closeout

- Confirm the release pack status is `ready`
- Confirm the readiness check returns exit code `0`
- Confirm the decommission closeout log says the automation is complete, but the AO gate and manual proofs are still tracked separately if they have not been closed yet
- Attach the evidence bundle, archive manifest, consistency report, release pack, checklist, and release evidence ledger to the release review
- Record the exact bundle paths in the release note
