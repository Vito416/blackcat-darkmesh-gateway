# Gateway Fresh-Machine Production Bootstrap Runbook

Use this runbook for a first-time production rollout on a new operator machine and for repeatable future release drills.

Architecture baseline for this runbook: Node gateway service on VPS behind Cloudflare Tunnel, with AO/-write/-worker integrations over HTTP APIs.

## 1) Hard prerequisites

- Access to the `blackcat-darkmesh-gateway` repo and release branch.
- Access to production secrets for gateway env vars (do not commit secret files).
- At least two gateway base URLs for cross-gateway consistency checks.
- AO gate and decommission docs present under `ops/decommission/`:
  - `ops/decommission/ao-dependency-gate.json`
  - `ops/decommission/FINAL_MIGRATION_SUMMARY.md`
  - `ops/decommission/SIGNOFF_RECORD.md`
- Runtime tooling (CI parity): Node.js `20.x`, npm `10.x`, git, and curl.

## 2) Fresh-machine install and repo bootstrap

Example for Ubuntu/Debian hosts:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version
npm --version
```

Clone and install:

```bash
git clone <your-fork-or-origin-url> blackcat-darkmesh-gateway
cd blackcat-darkmesh-gateway
npm ci
npm run build
npm run test:integrity-fast
```

Installer alternative (Node-only VPS path):

```bash
bash ops/install/bin/install-all.sh
```

See `ops/install/README.md` for manual steps that stay outside automation (Tailscale + cloudflared account login).

## 3) Environment bootstrap using repo examples

Create a non-committed env file from `config/example.env`:

```bash
mkdir -p tmp/bootstrap tmp/release-drills
cp config/example.env tmp/bootstrap/gateway.production.env
```

Edit `tmp/bootstrap/gateway.production.env` and replace all placeholder secrets (`change-me`, empty tokens, endpoints).

Load env into the shell:

```bash
export BOOTSTRAP_ENV_FILE="$(pwd)/tmp/bootstrap/gateway.production.env"
set -a
source "$BOOTSTRAP_ENV_FILE"
set +a
```

Load template worker maps from the example JSON files (replace with production maps before rollout):

```bash
export GATEWAY_TEMPLATE_WORKER_URL_MAP="$(cat config/template-worker-routing.example.json)"
export GATEWAY_TEMPLATE_WORKER_TOKEN_MAP="$(cat config/template-worker-token-map.example.json)"
export GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP="$(cat config/template-worker-signature-ref-map.example.json)"
export GATEWAY_TEMPLATE_VARIANT_MAP="$(cat config/template-variant-map.example.json)"
export REQUIRED_TEMPLATE_SITES="site-alpha,site-beta"
```

`config/template-variant-map.example.json` is also the CI/audit deterministic fallback when `GATEWAY_TEMPLATE_VARIANT_MAP` is unset.

If forget-forward relay is enabled for production, load the baseline and replace placeholders:

```bash
set -a
source config/forget-forward.example.env
set +a
```

Set drill-specific vars:

```bash
export GW_A_URL="https://gateway-a.example.com"
export GW_B_URL="https://gateway-b.example.com"
export CONSISTENCY_URLS="$GW_A_URL,$GW_B_URL"
export RELEASE_VERSION="1.4.0"
export DRILL_DIR="$(pwd)/tmp/release-drills/${RELEASE_VERSION}-$(date -u +%Y%m%dT%H%M%SZ)"
export OPERATOR_NAME="ops-oncall"
mkdir -p "$DRILL_DIR"
```

## 4) Strict preflight checks (exact command order)

Run these before the release drill. All commands should exit `0`.

```bash
npm run ops:validate-template-backend-contract -- --strict --json

npm run ops:validate-hosting-readiness -- \
  --profile "$GATEWAY_RESOURCE_PROFILE" \
  --env-file "$BOOTSTRAP_ENV_FILE" \
  --strict --json

npm run ops:check-template-worker-routing-config -- \
  --url-map "$GATEWAY_TEMPLATE_WORKER_URL_MAP" \
  --token-map "$GATEWAY_TEMPLATE_WORKER_TOKEN_MAP" \
  --strict --json

npm run ops:check-template-worker-map-coherence -- \
  --require-token-map \
  --require-signature-map \
  --strict --json

npm run ops:check-template-signature-ref-map -- \
  --require-sites "$REQUIRED_TEMPLATE_SITES" \
  --strict --json

node scripts/validate-template-variant-map-config.js \
  --strict \
  --allow-placeholders \
  --require-sites "$REQUIRED_TEMPLATE_SITES"

npm run ops:check-forget-forward-config -- --strict --json

npm run ops:validate-consistency-preflight -- \
  --urls "$CONSISTENCY_URLS" \
  --mode pairwise \
  --profile "$GATEWAY_RESOURCE_PROFILE" \
  --token "$GATEWAY_INTEGRITY_STATE_TOKEN" \
  --json
```

Compatibility note: the validator command keeps the historical `validate-hosting-readiness` name, but it validates VPS deployment profiles.

If `/integrity/state` is intentionally public, replace the token flag with `--allow-anon`.

For real production maps (no placeholders), run the same validator without `--allow-placeholders`.

## 5) Strict release-drill sequence (canonical)

First print the exact plan without running network steps:

```bash
npm run ops:run-release-drill -- \
  --urls "$CONSISTENCY_URLS" \
  --out-dir "$DRILL_DIR" \
  --profile "$GATEWAY_RESOURCE_PROFILE" \
  --mode pairwise \
  --token "$GATEWAY_INTEGRITY_STATE_TOKEN" \
  --release "$RELEASE_VERSION" \
  --strict \
  --dry-run
```

Then run the real drill:

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

`ops:run-release-drill` runs this exact sequence:

1. `validate-consistency-preflight`
2. `compare-integrity-matrix`
3. `export-consistency-report`
4. `export-integrity-evidence`
5. `latest-evidence-bundle`
6. `check-evidence-bundle`
7. `validate-ao-dependency-gate` (`ops/decommission/ao-dependency-gate.json`)
8. `check-legacy-core-extraction-evidence`
9. `check-legacy-crypto-boundary-evidence`
10. `check-template-worker-map-coherence`
11. `check-forget-forward-config`
12. `check-template-signature-ref-map`
13. `check-template-variant-map`
14. `build-release-evidence-pack`
15. `build-release-signoff-checklist`
16. `check-release-readiness`
17. `build-release-drill-manifest`
18. `validate-release-drill-manifest`
19. `check-release-drill-artifacts`
20. `build-release-evidence-ledger`

## 6) Expected artifacts

Expected under `$DRILL_DIR` after a strict run:

- `consistency-matrix.json`
- `consistency-drift-report.md`
- `consistency-drift-summary.json`
- `latest-evidence-bundle.json`
- `ao-dependency-gate.validation.txt`
- `legacy-core-extraction-evidence.json`
- `legacy-crypto-boundary-evidence.json`
- `template-worker-map-coherence.json`
- `forget-forward-config.json`
- `template-signature-ref-map.json`
- `template-variant-map.json`
- `release-evidence-pack.md`
- `release-evidence-pack.json`
- `release-signoff-checklist.md`
- `release-readiness.json`
- `release-drill-checks.json`
- `release-drill-manifest.json`
- `release-drill-manifest.validation.txt`
- `release-drill-check.json`
- `release-evidence-ledger.md`
- `release-evidence-ledger.json`
- `evidence/<timestamped-bundle>/compare.txt`
- `evidence/<timestamped-bundle>/attestation.json`
- `evidence/<timestamped-bundle>/manifest.json`

Strict completeness gate:

```bash
npm run ops:check-release-drill-artifacts -- --dir "$DRILL_DIR" --strict --json
```

## 7) Decommission closeout pass (same drill directory)

Run closeout against the same `$DRILL_DIR` and AO gate file under `ops/decommission/`:

```bash
npm run ops:run-decommission-closeout -- \
  --dir "$DRILL_DIR" \
  --ao-gate ops/decommission/ao-dependency-gate.json \
  --profile "$GATEWAY_RESOURCE_PROFILE" \
  --env-file "$BOOTSTRAP_ENV_FILE" \
  --operator "$OPERATOR_NAME" \
  --decision pending \
  --strict \
  --json
```

Expected decommission artifacts:

- `$DRILL_DIR/decommission-evidence-log.md`
- `$DRILL_DIR/decommission-evidence-log.json`

Note: strict closeout remains blocked until AO required checks and manual proof links are complete.

## 8) Triage table (common failures)

| Failing command | Typical cause | First response |
| --- | --- | --- |
| `npm ci` | Node/npm mismatch or lockfile/network issue | Confirm Node `20.x`, npm `10.x`, retry with a clean network path. |
| `ops:validate-hosting-readiness --strict` (deployment-profile readiness) | Env values violate selected profile limits | Fix keys in `tmp/bootstrap/gateway.production.env` to match `GATEWAY_RESOURCE_PROFILE`. |
| `ops:check-template-worker-routing-config --strict` | URL/token map JSON malformed or missing coverage | Rebuild from `config/template-worker-routing.example.json` and `config/template-worker-token-map.example.json`; rerun strict check. |
| `ops:check-template-worker-map-coherence --strict` | URL/token/signatureRef maps are out of sync | Ensure all three maps contain the same site keys before rerun. |
| `ops:check-template-signature-ref-map --strict` | Missing signature refs for required sites | Fill `GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP` for every `REQUIRED_TEMPLATE_SITES` key. |
| `node scripts/validate-template-variant-map-config.js --strict` | Missing or unsupported template variants for one or more sites | Rebuild `GATEWAY_TEMPLATE_VARIANT_MAP` from the intended source map (example file for bootstrap, secrets for production) and rerun strict validation. |
| `ops:check-forget-forward-config --strict` | Relay URL missing/invalid, token blank, or timeout out of range | Fix `GATEWAY_FORGET_FORWARD_URL`, `GATEWAY_FORGET_FORWARD_TOKEN`, and timeout (`100..30000`). |
| `ops:validate-consistency-preflight` | Bad URL list, unsupported mode/profile, or missing token | Recheck `CONSISTENCY_URLS`, `GATEWAY_RESOURCE_PROFILE`, and auth mode (`--token` vs `--allow-anon`). |
| `ops:run-release-drill` (step 2/4/6) | Endpoint/network/auth/evidence-bundle failure | Test `/integrity/state` URLs manually with the same token; inspect bundle `compare.txt` when evidence export fails. |
| `ops:run-release-drill` (step 14/16) | Pack/readiness not `ready` due blockers | Open `$DRILL_DIR/release-evidence-pack.json` and `$DRILL_DIR/release-readiness.json` and clear listed blockers. |
| `ops:check-release-drill-artifacts --strict` | Missing files or cross-file release mismatch | Inspect `$DRILL_DIR/release-drill-check.json` and regenerate missing artifacts from the same drill directory. |
| `ops:run-decommission-closeout --strict` | AO gate still open or manual proof links missing | Check `ops/decommission/ao-dependency-gate.json`, then fill links in `$DRILL_DIR/decommission-evidence-log.json`. |

## 9) Future-proof operator rules

- Treat `npm run ops:run-release-drill -- --dry-run` as the source of truth for step order.
- Keep AO/decommission references anchored to `ops/decommission/*` paths (no legacy `kernel-migration/*` paths).
- Keep `ops/decommission/DECOMMISSION_CHECKLIST.md`, `ops/decommission/FINAL_MIGRATION_SUMMARY.md`, and `ops/decommission/SIGNOFF_RECORD.md` in sync with the archived drill directory.
