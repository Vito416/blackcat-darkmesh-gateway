# Cloudflare Worker (Inbox + Thin Trusted Layer)

Purpose
- Thin, low-cost trusted layer (Cloudflare Free) for small/medium sites.
- Short-lived storage of encrypted envelopes (PII) with TTL + delete-on-download.
- Trusted holder of **secrets** that must not live on AO/Arweave (e.g., PSP API keys, OTP secrets, SMTP token).
- Hook for AO `ForgetSubject` to wipe all envelopes for a subject hash.
- Optional notification fan-out (email/webhook) without persisting plaintext.

What it should do (scope)
- Inbox with TTL + delete-on-download.
- Forget endpoint (auth-protected) to purge by subject prefix.
- Secret-backed operations: signing/HMAC helpers and PSP webhook verification (shared secrets).
- Notification relay: send email/WebPush/Webhook using stored secrets; never store plaintext payload.
- Rate limiting and replay protection for incoming hooks.
- Scheduled janitor to delete expired envelopes and stray items.

What it should NOT do
- No long-term database of PII; only short-lived encrypted blobs.
- No business logic for catalog/orders; that stays in write/AO.
- No heavy compute or large file handling (Cloudflare free limits).
- No persistent auth-account PIP state in worker KV (OTP account DB, long-lived sessions, profile store).
- Any full PIP database belongs offline under site admin custody, not in the shared worker runtime.

PIP retention scope lock
- Worker inbox is intentionally an ephemeral transport/cache layer.
- Hard retention ceiling is enforced in code: `INBOX_TTL_HARD_MAX_SECONDS=86400` (24h max).
- `INBOX_TTL_DEFAULT` / `INBOX_TTL_MAX` can only tighten retention, not extend beyond 24h.
- Operational policy and checklist: `ops/runbooks/pip-retention-scope-lock.md`.

Data model
- KV namespace `INBOX_KV`.
- Key format: `subjectHash:nonce` -> `{ payload, exp }` (payload is already encrypted with admin public key).
- TTL enforced via KV expiration + `exp` field; janitor double-checks.

API (baseline)
- `POST /inbox` body `{ subject, nonce, payload, ttlSeconds? }` → 201; stores + sets TTL.
- `GET /inbox/:subject/:nonce` → 200 `{ payload, exp }`; deletes after read.
- `POST /forget` body `{ subject }` → 200; auth via `Authorization: Bearer <WORKER_FORGET_TOKEN>` (legacy fallback still supported outside strict mode).
- `POST /notify` (optional) body `{ to?, webhookUrl?, subject?, text?, html?, data? }` → 200; uses SendGrid/webhook and never persists plaintext payload.
- `GET /health` — liveness check, returns `{ status: "ok" }`.
- `GET /api/health` — AO bridge readiness (site/write pid + wallet presence).
- `POST /api/public/site-by-host` — AO registry lookup (`GetSiteByHost`) for host → site metadata.
- `POST /api/public/resolve-route` — AO read adapter for gateway template calls.
- `POST /api/public/page` — AO read adapter for gateway template calls.
- `POST /api/checkout/order` — write adapter (`CreateOrder`) with optional worker auto-sign.
- `POST /api/checkout/payment-intent` — write adapter (`CreatePaymentIntent`) with optional worker auto-sign.
- `GET /metrics` — Prometheus text; protect via `METRICS_BASIC_USER`/`METRICS_BASIC_PASS` or `METRICS_BEARER_TOKEN`.
- `scheduled` (cron) – deletes expired items, cleans malformed entries.

Secrets to keep here (examples)
- PSP webhook secrets (Stripe/PayPal/GoPay), HMAC salts.
- OTP/TOTP secret material only when used for short-lived challenge signing/verification flows.
- SMTP/Sendgrid/WebPush keys.
- Admin public key is used client-side to encrypt; private keys stay offline, **never** here.

Env/config
- `INBOX_TTL_DEFAULT`, `INBOX_TTL_MAX`
- `INBOX_KV` (KV binding)
- `REPLAY_LOCKS` (Durable Object binding, required for strong replay lock)
- Scoped route tokens (recommended):
  - `WORKER_READ_TOKEN` for `GET /inbox/:subject/:nonce`
  - `WORKER_FORGET_TOKEN` for `POST /forget`
  - `WORKER_NOTIFY_TOKEN` for `POST /notify`
  - `WORKER_SIGN_TOKEN` for `POST /sign`
- Legacy fallback token: `WORKER_AUTH_TOKEN` (`FORGET_TOKEN` also accepted in non-strict mode)
- `WORKER_STRICT_TOKEN_SCOPES=1` to fail closed when scoped token vars are missing (default in prod-like mode)
- `METRICS_BASIC_USER`/`METRICS_BASIC_PASS` or `METRICS_BEARER_TOKEN` (protect /metrics)
- `SENDGRID_KEY` / `NOTIFY_WEBHOOK` (optional)
- `NOTIFY_WEBHOOK_ALLOWLIST` (comma-separated hostnames allowed for webhook URLs; empty = deny all/fail-closed)
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` (per-IP for inbox/notify)
- `SUBJECT_MAX_ENVELOPES` (max live envelopes per subject)
- `PAYLOAD_MAX_BYTES` (reject oversized payloads)
- `REPLAY_TTL` (seconds; reject resubmission of same subject+nonce)
- `REPLAY_STRONG_MODE` (`1` recommended in production; fail closed if `REPLAY_LOCKS` is missing)
- `NOTIFY_RATE_MAX`, `NOTIFY_RATE_WINDOW` (per-IP for /notify)
- `INBOX_HMAC_SECRET` (optional HMAC check for /inbox; header `X-Signature`)
- `NOTIFY_HMAC_SECRET` (HMAC check for /notify; set `NOTIFY_HMAC_OPTIONAL=1` only if unsigned allowed)
- `NOTIFY_FROM` (default from address for SendGrid)
- `REQUIRE_SECRETS` (prod: fail fast if WORKER_AUTH_TOKEN/INBOX_HMAC_SECRET/NOTIFY_HMAC_SECRET unset)
- `REQUIRE_METRICS_AUTH` (prod: 500 /metrics if auth secrets not configured)
- `LITE_MODE` (optional): when `1`, notify dedup is disabled (saves KV writes for CF free tier).
- `LOG_LEVEL` (debug|info|error): default `info`; `error` suppresses info logs.
- Gateway AO/write bridge vars:
  - `AO_MODE`, `AO_HB_URL`, `AO_HB_SCHEDULER`
  - `AO_REGISTRY_PROCESS_ID` (optional; falls back to `AO_SITE_PROCESS_ID` when unset)
  - `AO_SITE_PROCESS_ID`, `WRITE_PROCESS_ID`
  - `AO_WALLET_JSON` (Arweave JWK JSON used for write transport)
  - optional `AO_WALLET_PKCS8_B64` (base64 PKCS#8 private key; preferred when JWK import is restricted)
  - `GATEWAY_TEMPLATE_TOKEN` or `GATEWAY_TEMPLATE_TOKEN_MAP` (site->token map)
  - `GATEWAY_TEMPLATE_TOKEN_OPTIONAL` (default `0`, fail-closed)
  - `GATEWAY_READ_TIMEOUT_MS`, `GATEWAY_WRITE_TIMEOUT_MS`, `GATEWAY_WRITE_RETRIES`
  - `GATEWAY_WRITE_ACCEPT_EMPTY_RESULT` (default `1`)
  - `GATEWAY_WRITE_AUTO_SIGN` (default `1`; when `0`, signatures must be provided by caller)
  - `SIGN_POLICY_JSON` (optional fail-closed allowlist for `/sign`; JSON shape: `{ "sites": { "<siteId>": { "<Action>": ["role", ...] } }, "signatureRefs": { "<signatureRef>": { "<Action>": ["role", ...] } } }`; siteId is read from `siteId` or `payload.siteId`, signatureRef from the request or `WORKER_SIGNATURE_REF`)

Build/Deploy
- Fill `worker/wrangler.toml` (copy from `wrangler.toml.example`; set KV id). Fill `ops/env.prod.example` → `/etc/blackcat/worker.env` with real secrets (fail-closed baseline).
- Keep Durable Object migration/binding from `wrangler.toml.example` (`ReplayLockDurableObject` + `REPLAY_LOCKS`) before enabling `REPLAY_STRONG_MODE=1`.
- `npm install` in `worker/`
- `wrangler dev` for local/miniflare test
- `wrangler publish --env production` (or use deploy script below). Cloudflare Workers need `compatibility_flags = ["nodejs_compat"]` (already in `wrangler.toml.example`) to resolve `buffer`.
- Load/perf smoke: `docker run --rm --network host -v $PWD:/repo -w /repo grafana/k6 run ops/loadtest/k6-worker.js` (expects miniflare at :8787 with HMAC secrets).
- Lite k6 profile (for CF free tier):
  `docker run --rm -v $PWD:/repo -w /repo grafana/k6 run ops/loadtest/k6-worker-lite.js \
    -e WORKER_BASE_URL=https://<your-worker>.workers.dev \
    -e INBOX_HMAC_SECRET=<secret> -e NOTIFY_HMAC_SECRET=<secret> -e WORKER_AUTH_TOKEN=<token> -e LITE_MODE=1`
- Shortcut runner: `ops/loadtest/run-lite.sh` (expects the same env vars exported; see script header).
- Chaos/replay profile: `docker run --rm -v $PWD:/repo -w /repo grafana/k6 run ops/loadtest/k6-worker-chaos.js \
    -e WORKER_BASE_URL=https://<your-worker>.workers.dev \
    -e INBOX_HMAC_SECRET=<secret> -e NOTIFY_HMAC_SECRET=<secret> -e WORKER_AUTH_TOKEN=<token> -e LITE_MODE=1`

Production-like smoke (CF Free) — 2026-03-19
- Profile: k6 lite (10 rps /inbox, 5 rps /notify, 60s), `LITE_MODE=1`, rate limit defaults 50 req / 60s.
- Result: 899 total, 898/899 checks OK; 1 inbox call rate-limited (expected). p95 latency 268ms, max 747ms. `http_req_failed` high only because 429s count as failures—adjust threshold if needed.
- Command used (from `worker/`):
  `docker run --rm -v $PWD:/repo -w /repo grafana/k6 run ops/loadtest/k6-worker-lite.js \
     -e WORKER_BASE_URL=https://<your-worker>.workers.dev \
     -e INBOX_HMAC_SECRET=$INBOX_HMAC_SECRET \
     -e NOTIFY_HMAC_SECRET=$NOTIFY_HMAC_SECRET \
     -e WORKER_AUTH_TOKEN=$WORKER_AUTH_TOKEN \
     -e LITE_MODE=1`

- CF deploy (WSL):  
  1) `export CLOUDFLARE_API_TOKEN=<token>` (scopes: Workers Scripts Edit, KV Edit, User Details Read).  
  2) `export CLOUDFLARE_ACCOUNT_ID=<your account id>` (CF Dashboard → Workers & Pages → Overview).  
  3) `cp wrangler.toml.example wrangler.toml` (local only, gitignored).  
  4) `./deploy_cf.sh` (creates KV, generates random secrets, deploys with wrangler@4).  
  5) Worker URL and generated secrets are printed at the end—store them in your vault.

Local testing
- Vitest/Miniflare run with in-memory KV/D1 (`TEST_IN_MEMORY_KV=1` in `wrangler.toml`) to avoid local SQLite locks.
- Docker option: `docker compose -f docker-compose.test.yml run --rm worker-test` (installs workerd binaries and runs `npm test`).
- Pen-test (webhook/auth) via Docker without local Node:
  - `docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "npm ci && npm test -- --run test/metrics-auth.test.ts"`
- Load test harness (k6) with HMAC + nonce: see `ops/loadtest/README.md`.

Env vars (extra)
- `TEST_IN_MEMORY_KV` — dev/test only; ignored in production (only value `1` enables the in-memory shim).
- Metrics exposed (examples): `worker_inbox_put_total`, `worker_inbox_replay_total`, `worker_rate_limit_blocked_total`, `worker_inbox_expired_total`, `worker_forget_deleted_total`, `worker_notify_rate_blocked_total`, `worker_metrics_auth_blocked_total`, `worker_metrics_auth_ok_total`, `worker_notify_hmac_invalid_total`, `worker_notify_hmac_optional` (gauge), `worker_notify_subject_blocked_total`, `worker_notify_breaker_open_total`, `worker_notify_host_blocked_total`.
- Rate-limit tuning: defaults now 300 req / 60s per IP (≈5 rps). Raise in env if your SLA needs more headroom.

Runbook snippets
- Secrets rotation: `wrangler secret put <NAME> --env production` for WORKER_AUTH_TOKEN / INBOX_HMAC_SECRET / NOTIFY_HMAC_SECRET / METRICS_BEARER_TOKEN; then `wrangler deploy --env production`.
- Scoped-token rotation (P1-01): see `ops/runbooks/token-scope-rotation.md`.
- Replay contention drill (P1-02): `npm run ops:drill:replay` or see `ops/runbooks/replay-contention-drill.md`.
- PIP retention scope lock: see `ops/runbooks/pip-retention-scope-lock.md`.
- Cron/janitor verification: `wrangler tail --env production` and watch scheduled runs (*/5). Optionally `wrangler deployments` to confirm latest version live.
- Backup stance: KV is a short-lived cache of encrypted envelopes; data loss is acceptable by design. If you need retention, mirror writes to R2/D1 outside the worker path.
- Monitoring hook (Prom/Grafana): scrape `/metrics` with bearer auth. Example Prom job:
  ```
  - job_name: blackcat_worker
    metrics_path: /metrics
    bearer_token: ${METRICS_BEARER_TOKEN}
    static_configs: [{ targets: ['<your-worker>.workers.dev'] }]
  ```
  Suggested alerts:  
  - `increase(worker_rate_limit_blocked_total[5m]) > 100`  
  - `increase(worker_inbox_replay_total[5m]) > 50`  
  - `increase(worker_notify_hmac_invalid_total[5m]) > 10`  
  - `increase(worker_notify_subject_blocked_total[5m]) > 20` (spray/abuse)  
  - `increase(worker_notify_breaker_open_total[5m]) > 5` (PSP/webhook failing)  
  - `gauge(worker_inbox_janitor_enabled) == 0` (cron disabled unexpectedly)  
  - `increase(worker_notify_host_blocked_total[5m]) > 0` (SSRF/invalid webhook host attempts)
- Notify live check: set `NOTIFY_WEBHOOK=https://httpbin.org/status/200` (or real endpoint) and run the chaos profile’s `notifyFail` with a 200 URL to validate dedupe/retries; keep `LITE_MODE=1` for CF Free.
