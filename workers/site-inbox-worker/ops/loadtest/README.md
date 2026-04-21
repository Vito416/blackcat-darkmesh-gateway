# k6 load harness (Worker)

What it covers
- `/inbox` happy-path under the configured limit, then pushes past `RATE_LIMIT_MAX` to confirm 429s.
- `/notify` breaker probe: repeated failing deliveries on a fixed `x-breaker-key` until `NOTIFY_BREAKER_THRESHOLD` trips.
- HMAC headers are generated from env secrets; each `/inbox` call uses a fresh nonce to avoid replay blocks.

Prereqs
- Docker (preferred) or a local `k6` binary.
- Running Worker target (local `wrangler dev`/Miniflare or staging URL) with KV bound.

Start the Worker locally with HMAC + breaker-friendly settings (example)
```bash
cd worker
FORGET_TOKEN=loadtest-token \
INBOX_HMAC_SECRET=loadtest-inbox \
NOTIFY_HMAC_SECRET=loadtest-notify \
NOTIFY_DEDUPE_TTL=0 \        # disable dedupe so breaker attempts are not short-circuited
NOTIFY_RATE_MAX=0 \          # disable notify rate limit; focus on breaker
NOTIFY_BREAKER_THRESHOLD=3 \
NOTIFY_BREAKER_COOLDOWN=60 \
RATE_LIMIT_MAX=50 \
TEST_IN_MEMORY_KV=1 \
wrangler dev --ip 0.0.0.0 --port 8787
```

Run the k6 harness (Docker)
```bash
cd worker
docker run --rm -it --network host \
  -v "$PWD":/repo -w /repo/worker \
  -e WORKER_BASE_URL=http://127.0.0.1:8787 \
  -e INBOX_HMAC_SECRET=loadtest-inbox \
  -e NOTIFY_HMAC_SECRET=loadtest-notify \
  -e FORGET_TOKEN=loadtest-token \
  -e RATE_LIMIT_MAX=50 \
  -e NOTIFY_BREAKER_THRESHOLD=3 \
  -e FAILING_WEBHOOK_URL=https://httpbin.org/status/500 \
  grafana/k6 run ops/loadtest/k6-worker.js
```
- macOS/Windows Docker: replace `http://127.0.0.1:8787` with `http://host.docker.internal:8787` and drop `--network host`.
- Local binary alternative: `k6 run ops/loadtest/k6-worker.js` with the same env vars.

How to read results
- Scenario `inbox_below_limit` should show 0x 429 (threshold enforces `count<1`).
- Scenario `inbox_limit_probe` must show at least one 429 (threshold `count>0`) proving the limiter trips near `RATE_LIMIT_MAX`.
- Scenario `notify_breaker` should end with a 429 once failures reach `NOTIFY_BREAKER_THRESHOLD`; failing webhook defaults to `https://httpbin.org/status/500`.

Tuning knobs (match Worker env to harness env)
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`: align with target deployment so the limit probe hits the real ceiling.
- `NOTIFY_BREAKER_THRESHOLD`, `NOTIFY_BREAKER_COOLDOWN`: lower in non-prod to observe breaker faster.
- `NOTIFY_DEDUPE_TTL`: set to `0` during breaker probes; otherwise dedupe will short-circuit repeats.
- `NOTIFY_RATE_MAX`: keep high/0 for breaker runs to avoid mixing rate-limit 429s with breaker 429s.
- `FAILING_WEBHOOK_URL`: point at any deterministic 5xx endpoint if `httpbin` is blocked.

Script location
- `worker/ops/loadtest/k6-worker.js`
  - Uses a fixed `x-forwarded-for` to make rate-limit math deterministic.
  - Generates hex HMAC (`X-Signature`) over the exact JSON body for both `/inbox` and `/notify`.

## Replay contention drill (P1-02)

Use the dedicated replay drill to validate same-nonce collision handling:

```bash
cd worker
WORKER_BASE_URL=https://<worker-host> \
REPLAY_DRILL_ATTEMPTS=4 \
REPLAY_DRILL_SUBJECT="drill-replay-$(date +%s)" \
REPLAY_DRILL_NONCE="collision-1" \
node ops/loadtest/replay-contention-drill.mjs --json
```

Expected pass condition:
- exactly one `201`
- remaining requests `409` replay
- no `5xx`

Runbook reference:
- `worker/ops/runbooks/replay-contention-drill.md`
- `worker/ops/runbooks/token-scope-rotation.md`
