# Blackcat Darkmesh Gateway
[![Project: Blackcat Mesh Nexus](https://img.shields.io/badge/Project-Blackcat%20Mesh%20Nexus-000?logo=github)](https://github.com/users/Vito416/projects/2) [![CI](https://github.com/Vito416/blackcat-darkmesh-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Vito416/blackcat-darkmesh-gateway/actions/workflows/ci.yml) [![Releases](https://img.shields.io/github/v/release/Vito416/blackcat-darkmesh-gateway?display_name=tag&sort=semver)](https://github.com/Vito416/blackcat-darkmesh-gateway/releases)

![Gateway Banner](.github/blackcat-darkmesh-gateway-banner.jpg)

Purpose
- Universal edge/backend that serves many sites from web3 (Arweave templates) to web2 UX.
- Caches and serves trusted front-end bundles, proxies API calls to Write AO, AO (read), and Worker.
- Holds only time‑bounded encrypted envelopes needed to deliver emails/webhooks; never stores long‑term PII.
- Webhook ingress (Stripe/PayPal) with signature verification, optional HMAC secret, and metrics.

Consolidation status
- Gateway is the active integration target for legacy backend modules.
- Legacy library snapshots were fully retired from this repo; request-path runtime now uses gateway-owned modules only under `src/runtime/**` and `src/clients/**`.
- Crypto policy bundle is maintained in `security/crypto-policy/` (gateway-owned, not a vendored snapshot).
- Template code remains intentionally separate in `blackcat-darkmesh-templates`; gateway enforces controlled backend access for deployed templates.

Migration status
- Active backlog and blocker split: `ops/decommission/BACKLOG.md`
- Decommission evidence checklist: `ops/decommission/DECOMMISSION_CHECKLIST.md`
- Integrity gate command: `npm run test:integrity-gate`
- Current migration goal: keep the gateway slice evidence-complete while AO-side dependencies finish and the final decommission gate is cleared.

## Quick operator loop
```bash
curl -fsS "${GATEWAY_BASE_URL:-http://localhost:8787}/integrity/state" -H "Authorization: Bearer ${GATEWAY_INTEGRITY_STATE_TOKEN}"
npm run test:integrity-gate
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://localhost:8787}" GATEWAY_INTEGRITY_INCIDENT_TOKEN="${GATEWAY_INTEGRITY_INCIDENT_TOKEN}" GATEWAY_TEMPLATE_TOKEN="${GATEWAY_TEMPLATE_TOKEN}" node scripts/e2e-integrity-incident-smoke.js
```

## P3 operator tools
```bash
npm run ops:compare-integrity -- --url ... --url ...
```

Key responsibilities
- Fetch + cache site front-end from Arweave (verified via manifest of trusted templates).
- API surface to browser: cart/checkout/session endpoints that forward to Write AO.
- PSP/webhook bridge: accept PSP callbacks, verify signature/cert, enqueue to Write AO; cache certs.
- Envelope cache: short TTL cache of encrypted PII blobs for async email/ops; wipe on expiry or ForgetSubject.
- Observability: expose metrics for cache hit/miss/expired, inbox rate-limit, webhook verify ok/fail, cert touches.
  - Replay visibility: `gateway_webhook_replay_total` increments on duplicate PSP deliveries (10m window by default).
  - DLQ/WAL from Write: dashboards/alerts consume `write.webhook.dlq_size` and `write.wal.bytes` to surface downstream backlog growth.
  - Suggested Grafana panels: cache hit/miss/expired rates, webhook verify fail/replay, PSP breaker open, cert pin/allow fails.

Data & privacy model
- PII stays encrypted at the edge; TTL cache only, bounded by Worker inbox TTL and merchant TTL.
- AO/Write hold only pseudonymous state (orders, inventory, idempotency, WAL) persisted to WeaveDB.
- Worker holds secrets (PSP keys, SMTP, OTP) and TTL inbox; Gateway never persists secrets.

Integration points
- To Worker: send inbox/notify; receive ForgetSubject → wipe gateway cache for subject.
- To Write AO: forward commands (CreateOrder, ProviderWebhook, IssueSession, etc.).
- To AO (read): serve catalog/public state to browser.

Runtime/tech
- Language/runtime TBD (edge-friendly). Must support:
  - TLS termination, header signing, HMAC verification.
  - Cert caching for PSP (e.g., PayPal).
  - Backoff/retry queues with jitter; circuit breaker per PSP endpoint.
  - Metrics exporter (Prometheus/OpenMetrics).

Configuration (per site)
- Arweave template txid + manifest (trusted templates list).
- Gateway cache TTL (<= Worker inbox TTL), max envelope size.
- PSP configs (keys, cert endpoints, webhook paths).
- Email/notify routing (via Worker notify).
- AO/Write endpoints + signing keys (if applicable).
- Env knobs:
    - `GATEWAY_CACHE_TTL_MS`, `GATEWAY_CACHE_MAX_ENTRY_BYTES`, `GATEWAY_CACHE_MAX_ENTRIES`
    - `GATEWAY_RL_WINDOW_MS`, `GATEWAY_RL_MAX`, `GATEWAY_RL_MAX_BUCKETS`
    - `GATEWAY_WEBHOOK_REPLAY_TTL_MS`, `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS`, `GATEWAY_WEBHOOK_SHADOW_INVALID` (return 202 instead of 401 on bad sig)
    - `GATEWAY_FORGET_TOKEN` (auth for /cache/forget)
    - `GW_CERT_CACHE_TTL_MS`, `GW_CERT_PIN_SHA256` (comma pins), `PAYPAL_CERT_ALLOW_PREFIXES` (comma prefixes)
- Integrity policy and snapshot:
    - `AO_INTEGRITY_URL` (AO endpoint for integrity snapshot)
    - `GATEWAY_INTEGRITY_CACHE_TTL_MS` (snapshot cache TTL in ms, default 10000)
    - `GATEWAY_INTEGRITY_POLICY_PAUSED=1` (env fallback pause switch)
    - `GATEWAY_INTEGRITY_POLICY_JSON` (optional JSON override, e.g. `{\"paused\":true}`)
    - `GATEWAY_INTEGRITY_CHECKPOINT_PATH` + `GATEWAY_INTEGRITY_CHECKPOINT_SECRET` (signed local checkpoint fallback)
    - `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS` (ignore older checkpoints; stale files are treated as absent)
    - `GATEWAY_INTEGRITY_DISKLESS=1` (force memory-only mode; disable checkpoint file reads/writes)
    - `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless|disabled|memory-only` (equivalent explicit checkpoint disable mode)
    - `GATEWAY_RESOURCE_PROFILE=wedos_small|wedos_medium|diskless` (profiled defaults for integrity fetch/retry cadence)
    - `AO_INTEGRITY_FETCH_TIMEOUT_MS`, `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS`, `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS` (AO/integrity fetch timeout + retry budget)
      - precedence: explicit fetch options > `AO_INTEGRITY_FETCH_*` env vars > `GATEWAY_RESOURCE_PROFILE` defaults
    - `GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE=1` (fail closed unless cache entries are integrity-verified)
    - `GATEWAY_INTEGRITY_STATE_TOKEN` (optional auth token for `GET /integrity/state`; accepts Bearer or `x-integrity-token`)
    - `GATEWAY_INTEGRITY_INCIDENT_TOKEN` (required auth token for `POST /integrity/incident`; accepts Bearer or `x-incident-token`)
    - `GATEWAY_INTEGRITY_INCIDENT_REPLAY_TTL_MS` (incident idempotency replay TTL; default 30m)
    - `GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP` (max retained incident IDs for replay dedupe; default 256)
    - `GATEWAY_INTEGRITY_INCIDENT_NOTIFY_URL` (optional incident forward target)
    - `GATEWAY_INTEGRITY_INCIDENT_NOTIFY_TOKEN` (optional Bearer token for incident forwarding)
    - `GATEWAY_INTEGRITY_INCIDENT_NOTIFY_HMAC` (optional HMAC secret; sent as `x-signature`)
    - `GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF=1` (optional secondary auth gate based on authority signature refs)
    - `GATEWAY_INTEGRITY_INCIDENT_REF_HEADER` (default `x-signature-ref`; can carry signer ref in header)
    - `GATEWAY_INTEGRITY_ROLE_ROOT_REFS` / `GATEWAY_INTEGRITY_ROLE_UPGRADE_REFS` / `GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS` / `GATEWAY_INTEGRITY_ROLE_REPORTER_REFS` (comma lists for rotation windows and AO bootstrap fallback)
- Template custom-backend guardrails:
  - `GATEWAY_TEMPLATE_TOKEN` (optional shared token required on `/template/call`)
  - `GATEWAY_TEMPLATE_ALLOW_MUTATIONS=1` (default is read-only; write actions blocked unless enabled)
  - `GATEWAY_TEMPLATE_CONTRACT_FILE` (optional path, default `config/template-backend-contract.json`; template actions must exist in this contract and match route+method)
  - `AO_PUBLIC_API_URL` / `AO_READ_URL` (public read upstream target)
  - `WRITE_API_URL` (write upstream target for checkout/write actions)
  - `WORKER_API_URL` / `WORKER_SIGN_URL` (worker signer endpoint base for single-tenant/simple deployments; gateway calls `/sign`)
  - `WORKER_AUTH_TOKEN` / `WORKER_SIGN_TOKEN` (worker signer auth token)
  - `GATEWAY_TEMPLATE_WORKER_URL_MAP` (multi-tenant worker signer routing map, JSON: `{ \"site-a\": \"https://worker-a.example\", \"site-b\": \"https://worker-b.example\" }`)
  - `GATEWAY_TEMPLATE_WORKER_TOKEN_MAP` (optional per-site signer token map, JSON with same keys as the URL map)
    - when signer map is configured, write actions fail closed for unknown `siteId`
  - `GATEWAY_TEMPLATE_VARIANT_MAP` (optional per-site template variant map, JSON `{ "<site>": { "variant": "signal|bastion|horizon", "templateTxId": "...", "manifestTxId": "..." } }`)
  - `GATEWAY_TEMPLATE_HMAC_SECRET` (optional HMAC signature header for forwarded template calls)
- Notify → Worker:
  - `WORKER_NOTIFY_URL`, `WORKER_AUTH_TOKEN` (alias: `WORKER_NOTIFY_TOKEN`), `WORKER_NOTIFY_HMAC`
  - `WORKER_NOTIFY_BREAKER_KEY` (default) or per provider `WORKER_NOTIFY_BREAKER_KEY_STRIPE` / `..._PAYPAL` / `..._GOPAY`; forwarded as `x-breaker-key` to isolate breaker state per provider.
- Metrics scrape example (Prometheus):
  ```
  scrape_configs:
    - job_name: gateway
      static_configs:
        - targets: ["gateway.local:8787"]
      metrics_path: /metrics
      basic_auth:
        username: ${GATEWAY_METRICS_USER}
        password: ${GATEWAY_METRICS_PASS}
  ```

Security
- Never store plaintext PII; only encrypted blobs with TTL.
- Enforce HMAC/signature on inbox/notify/webhooks.
- ForgetSubject hook triggers cache purge; scheduled purge for expired items.

Flows (high level)
- **Page serve**: Browser → Gateway → (cache hit) serve template bundle; on miss pull from Arweave, verify manifest sig, cache with TTL, serve.
- **Checkout**: Browser → Gateway → Write AO (CreateOrder/PaymentIntent) → AO read state → Gateway → Browser; PSP webhook → Gateway → Write AO; AO updates streamed to browser.
- **Inbox/PII**: Browser encrypts with admin pubkey → Gateway caches encrypted blob (TTL) → Worker inbox (optional) → Admin pulls via Web console; ForgetSubject wipes gateway cache.
- **Notify**: Write AO event → Gateway → Worker /notify → email/webhook.

“Next-gen” capabilities (ideas)
- **Content integrity by default**: manifest with signed template hashes; automatic hash-pin of all assets; optional COOP/CSP headers locked to verified origins.
- **Smart cache policy**: per-merchant TTL, admission control (don’t cache oversized blobs), probabilistic early refresh for hot assets.
- **Active defense**: rate-limit buckets per route + device fingerprint, optional proof-of-work (Javascript/WASM) for bots, Geo/IP anomalies surfaced in metrics.
- **Chaos-safe PSP handling**: shadow mode for new PSP configs, replayable webhook fixtures, cert hot-reload without restart.
- **Zero-trust to Worker**: all payloads envelope-encrypted; Gateway never sees decrypted content; HMAC from Worker on responses to detect tampering.
- **Edge rendering toggle**: for low-latency sites, allow server-side render of cached templates with public state injected from AO; falls back to static.

Forward-looking / Quantum-ready
- Plan for hybrid PQC keys (e.g., X25519+Kyber for transport, Ed25519+Dilithium for signatures) once libraries are stable; keep manifest format extensible to multiple key types.
- Store template manifest with algorithm identifiers and key rotation schedule; Gateway can enforce “pqc_required=true” flag per merchant.
- Deterministic builds (reproducible templates) to make post-quantum verification simpler.

Open items to design/implement
- Exact endpoint contract with browser (cart/checkout/session).
- Metrics/alerts defaults (thresholds) and dashboard layout.
- Deployment topology (per-merchant vs multi-tenant isolation).
- PQC rollout playbook (hybrid, then switch), including browser support detection.

## Proposed component layout
- **Template Fetcher**: pulls Arweave bundles, verifies manifest sig, pins hash, stores in cache.
- **Cache/Envelope Store**: encrypted TTL cache with wipe scheduler, subject-index for ForgetSubject, metrics emit.
- **API Proxy**: forwards browser API calls to Write AO (auth, idempotency key propagation), injects public AO state.
- **PSP Bridge**: webhook ingress, signature/cert verify, retry/backoff queue, breaker per PSP, emits status to Write AO.
- **Metrics/Alerts Exporter**: Prometheus/OpenMetrics; supports scrape auth tokens (see `ops/alerts.md`).
- **Config Service**: per-merchant config (template txid, TTLs, PSP endpoints) hot-reloadable without restart.

## API surface (draft)
- `/api/cart/*`, `/api/checkout/*`, `/api/session/*` → proxied to Write AO.
- `/api/public/*` → served from AO read state (cached).
- `/webhook/:psp` → PSP bridge ingress.
- `/template/call` → constrained template backend API (allowlisted actions only, schema-validated, optional token + HMAC).
- `/integrity/state` → read current runtime integrity state + latest AO/checkpoint snapshot details (optional token).
- `/integrity/incident` → authenticated incident intake (`report|ack|pause|resume`) with optional forwarding hook.
- `/metrics` → Prom/OpenMetrics (protected, text format; set `GATEWAY_REQUIRE_METRICS_AUTH=1` + bearer/basic creds).
- `/cache/forget` → internal, called by AO ForgetSubject (token-protected).

When `GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE=1`, cache PUT requests must include:
- `x-integrity-root` (trusted root reference)
- `x-integrity-hash` (sha256 hex of the uploaded body)

When cache admission limits are exceeded, cache PUT returns:
- `507 {"error":"cache_budget_exceeded"}`

## Security hardening (to implement)
- Strict CSP/COOP for served templates; SRI for all static assets.
- HMAC on browser→gateway API calls (optional) to deter tampering between CDN hops.
- mTLS / signed requests between Gateway↔Write AO/Worker where supported.
- Rate-limit buckets per IP + per session; PoW challenge toggle for abusive clients.

## Integrity incident operations
- Freeze mutating routes (runtime pause): `POST /integrity/incident` with `{ "event": "...", "action": "pause", "severity": "critical" }`.
- Resume normal mode: `POST /integrity/incident` with `{ "event": "...", "action": "resume" }`.
- Acknowledge/report without pause toggle: `action: "ack"` or `action: "report"`.
- Read current state: `GET /integrity/state` (returns policy source, pause status, active root/policy hash, release/authority/audit envelope).
- Optional role-aware gate:
  - enable `GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF=1`
  - send signer reference via `x-signature-ref` (or body `signatureRef`)
  - required roles by action:
    - `pause`/`resume`: `emergency` or `root`
    - `ack`/`report`: `reporter`, `emergency`, or `root`
  - refs come from AO snapshot authority plus local rotation overlays in `GATEWAY_INTEGRITY_ROLE_*_REFS`.
- Metrics to watch:
  - `gateway_cache_store_reject_total`
  - `gateway_cache_store_reject_size_total`
  - `gateway_cache_store_reject_capacity_total`
  - `gateway_ratelimit_pruned_total`
  - `gateway_webhook_replay_pruned_total`
  - `gateway_integrity_incident_total`
  - `gateway_integrity_incident_auth_blocked_total`
  - `gateway_integrity_incident_role_blocked_total`
  - `gateway_integrity_incident_notify_ok_total`
  - `gateway_integrity_incident_notify_fail_total`
  - `gateway_integrity_state_read_total`
  - `gateway_integrity_state_auth_blocked_total`
  - `gateway_integrity_audit_seq_from`
  - `gateway_integrity_audit_seq_to`
  - `gateway_integrity_audit_lag_seconds`
  - `gateway_integrity_checkpoint_age_seconds`

## Integrity checkpoint policy
- Only restore a checkpoint when it verifies and its age is within `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS`.
- Treat stale or unverifiable checkpoints as missing; fall back to AO fetch, then env state.
- For diskless or limited-hosting deployments, set `GATEWAY_INTEGRITY_DISKLESS=1` (or `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless`) and keep host runtime storage ephemeral.
- Keep `AO_INTEGRITY_FETCH_TIMEOUT_MS` and retry settings tight enough to fail fast on unhealthy AO/integrity endpoints, but not so tight that routine leader changes flap the control plane.

## Testing plan
- Unit: manifest verification, cache TTL/wipe, PSP signature verify.
- Integration: end-to-end checkout flow with fake PSP; webhook retries; cache wipe on ForgetSubject.
- Load: cache hit/miss ratios under concurrency; PSP breaker thresholds.
- Security: CSP/SRI enforcement tests; replay attacks for webhooks; envelope tamper tests.

### Quick test commands
- Unit + integration: `npm test`
- Resource hardening lane: `npm run test:hardening`
- Metrics auth smoke: `npm test -- --run tests/metrics-auth.test.ts`
- Webhook pen-tests: `npm test -- --run tests/webhook-pentest.test.ts`
- Bez lokálního Node: `docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "npm ci && npm test -- --run tests/webhook-pentest.test.ts"`

### Next execution order (P0 rollout)
1. `npm test`
2. `npm run build`
3. `npm test -- --run tests/integrity-client.test.ts`
4. `npm test -- --run tests/integrity-verifier.test.ts`
5. `npm test -- --run tests/integrity-policy-gate.test.ts`
6. `npm test -- --run tests/integrity-checkpoint.test.ts`
7. `npm test -- --run tests/integrity-parity.test.ts`
8. Re-run the full suite before any kernel-retirement decision.

## Kernel integrity migration
- Migration and decommission evidence from `blackcat-kernel-contracts` is tracked in `ops/decommission/`.
- Start with `ops/decommission/README.md`, then follow:
  - `KERNEL_PORT_SCOPE.md`
  - `AO_GATEWAY_DESIGN.md`
  - `BACKLOG.md`
  - `DECOMMISSION_CHECKLIST.md`

## Template security model
- Guardrails for the custom backend model are documented in `ops/decommission/TEMPLATE_BACKEND_GUARDRAILS.md`.
- High-level rule: templates can call only declared gateway APIs; they do not get direct data-store or secret access.

## Releases
- Release drafts are created from main; see the latest draft and published tags in [Releases](https://github.com/Vito416/blackcat-darkmesh-gateway/releases).
Open items to design/implement
- Exact endpoint contract with browser (cart/checkout/session).
- Dashboard layout and escalation policy across environments.
- Deployment topology (per-merchant vs multi-tenant isolation).


## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
