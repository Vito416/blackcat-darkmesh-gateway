#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[integrity-gate] build"
npm run build

echo "[integrity-gate] integrity-verifier"
npx vitest run tests/integrity-verifier.test.ts

echo "[integrity-gate] integrity-client"
npx vitest run tests/integrity-client.test.ts

echo "[integrity-gate] integrity-checkpoint"
npx vitest run tests/integrity-checkpoint.test.ts

echo "[integrity-gate] integrity-cache-enforcement"
npx vitest run tests/integrity-cache-enforcement.test.ts

echo "[integrity-gate] integrity-parity"
npx vitest run tests/integrity-parity.test.ts

echo "[integrity-gate] integrity-policy-gate"
npx vitest run tests/integrity-policy-gate.test.ts

echo "[integrity-gate] integrity-incident"
npx vitest run tests/integrity-incident.test.ts

echo "[integrity-gate] fetch-control"
npx vitest run tests/fetch-control.test.ts

echo "[integrity-gate] resource-hardening"
npx vitest run tests/resource-hardening.test.ts

echo "[integrity-gate] rate-replay-limits"
npx vitest run tests/rate-replay-limits.test.ts

echo "[integrity-gate] budget-metrics"
npx vitest run tests/budget-metrics.test.ts

echo "[integrity-gate] metrics-auth"
npx vitest run tests/metrics-auth.test.ts

echo "[integrity-gate] webhook-pentest"
npx vitest run tests/webhook-pentest.test.ts
