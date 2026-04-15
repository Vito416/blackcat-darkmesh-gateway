# Release Closeout Checklist (v1.4.0, 2026-04-15)

This is the exact operator path we used to reach a production-readiness **GO** decision for the live strict drill.

## 1) Use the existing live drill directory

- Drill directory:
  - `tmp/release-drills/live-1.4.0-token-20260415T1900Z`

## 2) Export the state token (do not hardcode)

```bash
export GATEWAY_INTEGRITY_STATE_TOKEN="$(python3 - <<'PY'
import json
from pathlib import Path
print(json.loads(Path('../blackcat-darkmesh-write/tmp/test-secrets.json').read_text())['GATEWAY_INTEGRITY_STATE_TOKEN'])
PY
)"
```

## 3) Run strict live drill with token

```bash
CONSISTENCY_URLS='https://gateway.blgateway.fun,https://gateway.blgateway.fun' \
GATEWAY_INTEGRITY_STATE_TOKEN="$GATEWAY_INTEGRITY_STATE_TOKEN" \
GATEWAY_TEMPLATE_WORKER_URL_MAP="$(node -e "const d=require('./tmp/release-drills/live-1.4.0-20260414T1310Z/template-worker-map-coherence.json'); process.stdout.write(JSON.stringify(d.maps.url));")" \
GATEWAY_TEMPLATE_WORKER_TOKEN_MAP="$(node -e "const d=require('./tmp/release-drills/live-1.4.0-20260414T1310Z/template-worker-map-coherence.json'); process.stdout.write(JSON.stringify(d.maps.token));")" \
GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP="$(node -e "const d=require('./tmp/release-drills/live-1.4.0-20260414T1310Z/template-worker-map-coherence.json'); process.stdout.write(JSON.stringify(d.maps.signatureRef));")" \
GATEWAY_TEMPLATE_VARIANT_MAP="$(node -e "const d=require('./tmp/release-drills/live-1.4.0-20260414T1310Z/template-variant-map.json'); process.stdout.write(JSON.stringify(d.map));")" \
REQUIRED_TEMPLATE_SITES='site-alpha' \
RELEASE_VERSION='1.4.0' \
AO_GATE_FILE='ops/decommission/ao-dependency-gate.json' \
DRILL_DIR='tmp/release-drills/live-1.4.0-token-20260415T1900Z' \
bash scripts/run-live-strict-drill.sh --skip-forget-forward
```

## 4) Build manual-proof evidence log

```bash
node scripts/build-decommission-evidence-log.js \
  --dir "tmp/release-drills/live-1.4.0-token-20260415T1900Z" \
  --operator "jaine" \
  --decision pending \
  --ticket "live-drill-2026-04-15" \
  --recovery-drill-link "ops/decommission/P1_WORKER_DRILLS_2026-04-15.md" \
  --ao-fallback-link "ops/decommission/live-probes/2026-04-15/ao-read-fallback-worker-live-2026-04-15-token-t30.md" \
  --rollback-proof-link "tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-drill-check.json" \
  --approvals-link "tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-signoff-checklist.md"
```

## 5) Verify manual proofs are complete

```bash
node scripts/check-decommission-manual-proofs.js \
  --file "tmp/release-drills/live-1.4.0-token-20260415T1900Z/decommission-evidence-log.json" \
  --json --strict
```

Expected:
- `status: "complete"`
- `missingCount: 0`

## 6) Final production readiness decision

```bash
node scripts/check-production-readiness-summary.js \
  --dir "tmp/release-drills/live-1.4.0-token-20260415T1900Z" \
  --ao-gate "ops/decommission/ao-dependency-gate.json" \
  --json
```

Expected:
- `decision: "GO"`
- `status: "ready"`
- `blockerCount: 0`

## 7) Closeout artifacts to attach in release review

- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-evidence-pack.md`
- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-evidence-pack.json`
- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-readiness.json`
- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-drill-manifest.json`
- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-drill-check.json`
- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/release-evidence-ledger.md`
- `tmp/release-drills/live-1.4.0-token-20260415T1900Z/decommission-evidence-log.json`

---

Recorded outcome for this run:
- strict drill: passed
- manual proofs: complete
- production readiness: **GO / ready**
