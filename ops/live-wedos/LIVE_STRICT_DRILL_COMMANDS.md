# Live Strict Drill Commands (1.4.0)

Use this right before first live traffic when real gateway endpoints and real worker maps are ready.

## 1) Export live inputs

```bash
export GW_A_URL="https://gateway-a.example.com"
export GW_B_URL="https://gateway-b.example.com"
export CONSISTENCY_URLS="$GW_A_URL,$GW_B_URL"

export GATEWAY_RESOURCE_PROFILE="wedos_medium"
export CONSISTENCY_MODE="pairwise"
export RELEASE_VERSION="1.4.0"
export REQUIRED_TEMPLATE_SITES="site-alpha,site-beta"
export AO_GATE_FILE="ops/decommission/ao-dependency-gate.json"
export DRILL_DIR="./tmp/release-drills/live-${RELEASE_VERSION}-$(date -u +%Y%m%dT%H%M%SZ)"

# Token mode (recommended). For public /integrity/state use --allow-anon later.
export GATEWAY_INTEGRITY_STATE_TOKEN="<real-integrity-state-token>"

# Optional env file used by validate-wedos-readiness
export BOOTSTRAP_ENV_FILE="./tmp/bootstrap/gateway.production.env"

# Real secret-backed maps (JSON strings)
export GATEWAY_TEMPLATE_WORKER_URL_MAP="$(cat ./tmp/ops/worker-url-map.live.json)"
export GATEWAY_TEMPLATE_WORKER_TOKEN_MAP="$(cat ./tmp/ops/worker-token-map.live.json)"
export GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP="$(cat ./tmp/ops/worker-signature-map.live.json)"
export GATEWAY_TEMPLATE_VARIANT_MAP="$(cat ./tmp/ops/template-variant-map.live.json)"
```

## 2) Dry-run the exact sequence first

```bash
npm run ops:run-live-strict-drill -- --dry-run
```

## 3) Execute strict live drill

```bash
npm run ops:run-live-strict-drill
```

If `/integrity/state` is intentionally public:

```bash
npm run ops:run-live-strict-drill -- --allow-anon
```

If forget-forward is intentionally disabled for this rollout:

```bash
npm run ops:run-live-strict-drill -- --skip-forget-forward
```

## 4) Final machine checks (explicit)

```bash
npm run ops:check-release-drill-artifacts -- --dir "$DRILL_DIR" --strict --json
npm run ops:check-decommission-readiness -- --dir "$DRILL_DIR" --ao-gate "$AO_GATE_FILE" --strict --json
npm run ops:check-production-readiness -- --dir "$DRILL_DIR" --ao-gate "$AO_GATE_FILE" --json
```

Expected closeout result for GO:
- `status: "ready"`
- `closeoutState: "ready"`
- `blockerCount: 0`

## 5) Archive evidence for signoff

Attach these from `$DRILL_DIR` to release review:
- `release-evidence-pack.md`
- `release-evidence-pack.json`
- `release-readiness.json`
- `release-drill-manifest.json`
- `release-drill-manifest.validation.txt`
- `release-drill-check.json`
- `release-evidence-ledger.md`
- `release-evidence-ledger.json`
- `template-variant-map.json`
- `evidence/<timestamped-bundle>/compare.txt`
- `evidence/<timestamped-bundle>/attestation.json`
- `evidence/<timestamped-bundle>/manifest.json`
