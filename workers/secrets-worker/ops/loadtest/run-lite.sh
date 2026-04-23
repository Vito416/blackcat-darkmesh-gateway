#!/usr/bin/env bash
set -euo pipefail

# Simple runner for the lite k6 profile.
# Expected env (export before running):
#   WORKER_BASE_URL=https://<your-worker>.workers.dev
#   INBOX_HMAC_SECRET=...
#   NOTIFY_HMAC_SECRET=...
#   WORKER_NOTIFY_TOKEN=... (or WORKER_AUTH_TOKEN for legacy fallback)

: "${WORKER_BASE_URL:?Set WORKER_BASE_URL to your deployed worker URL}"
: "${INBOX_HMAC_SECRET:?Set INBOX_HMAC_SECRET}"
: "${NOTIFY_HMAC_SECRET:?Set NOTIFY_HMAC_SECRET}"
WORKER_NOTIFY_TOKEN="${WORKER_NOTIFY_TOKEN:-${WORKER_AUTH_TOKEN:-}}"
: "${WORKER_NOTIFY_TOKEN:?Set WORKER_NOTIFY_TOKEN (or WORKER_AUTH_TOKEN)}"

docker run --rm -v "$PWD:/repo" -w /repo grafana/k6 run ops/loadtest/k6-worker-lite.js \
  -e WORKER_BASE_URL="$WORKER_BASE_URL" \
  -e INBOX_HMAC_SECRET="$INBOX_HMAC_SECRET" \
  -e NOTIFY_HMAC_SECRET="$NOTIFY_HMAC_SECRET" \
  -e WORKER_NOTIFY_TOKEN="$WORKER_NOTIFY_TOKEN" \
  -e LITE_MODE=1
