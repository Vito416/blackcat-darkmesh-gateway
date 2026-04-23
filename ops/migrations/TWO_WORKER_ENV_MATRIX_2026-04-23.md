# Two-worker env matrix (P0)

Date: 2026-04-23  
Status: implementation input  
Scope: Secrets Worker (runtime/secrets) + Async Worker (async/cron)

## Changelog (2026-04-23 sync)

### Landed in this wave (env-affecting)

- [x] Secrets Worker route assertion endpoint exists and requires auth/signing inputs.
- [x] Async Worker DNS/TXT + cfg validation flow exists and requires explicit upstream allowlists.
- [x] Async Worker job + scheduled refresh wiring exists and needs production-safe limits.

### What is next (objective)

- [ ] Align wrangler templates with this matrix for both workers (required values present, no placeholders).
- [ ] Add per-environment secret rotation checklist and verification command set.
- [ ] Add a preflight script that fails deploy if required env/bindings are missing.

### Blockers

- [ ] Tenant provisioning is still partially manual.
- [ ] Some production values (allowlists/cohorts) are not yet centrally versioned.

## Constraint

- **No standalone resolver server**. All resolver duties are split between Secrets Worker and Async Worker.

## Ownership split (env authority)

| Domain | Secrets Worker | Async Worker |
|---|---|---|
| Assertion signing + replay control env | owner | no |
| DNS/TXT/AR/HB refresh env | no | owner |
| Phase flags (`OBSERVE/SHADOW/ENFORCE`) | consumer | owner |

## Conventions

- `Required`: mandatory for production deploy.
- `Optional`: may be omitted; safe default applies.
- Secrets must be stored with `wrangler secret put` (never committed to git).

---

## Secrets Worker (runtime/secrets) env

| Variable | Required | Default | Purpose | Security notes |
|---|---|---|---|---|
| `WORKER_STRICT_TOKEN_SCOPES` | Required | `1` | Enforce scoped auth token checks | Keep enabled (`1`) in prod. |
| `AUTH_REQUIRE_SIGNATURE` | Required | `1` | Require signed privileged requests | Must stay fail-closed. |
| `AUTH_REQUIRE_NONCE` | Required | `1` | Require nonce for anti-replay | Pair with nonce cache binding. |
| `WORKER_AUTH_TOKEN` | Required (secret) | none | Internal auth baseline token | Rotate regularly; never reuse cross-worker. |
| `WORKER_READ_TOKEN` | Required (secret) | none | Scoped read token | Limit to read-only paths. |
| `WORKER_SIGN_TOKEN` | Required (secret) | none | Scoped legacy sign token | Keep for existing endpoints until full route-assert cutover. |
| `ROUTE_ASSERT_TOKEN` | Required (secret) | none | Auth token for `POST /route/assert` | Must be distinct from generic worker tokens. |
| `ROUTE_ASSERT_SIGNING_KEY_HEX` | Required (secret) | none | Private key for route assertion signatures | 64-hex Ed25519 private key; rotate on compromise. |
| `INTERNAL_CALL_HMAC_SECRET` | Required (secret) | none | HMAC for async->runtime internal envelope | Distinct from inbox/notify HMAC secrets. |
| `ROUTE_ASSERT_TTL_SEC` | Optional | `120` | Max assertion validity window | Keep <=120s to reduce replay window. |
| `ROUTE_ASSERT_SIGNATURE_REF` | Optional | `worker-ed25519` | Signature reference included in assertion response | Pin verify policy to expected refs. |
| `HB_ALLOWED_HOSTS` | Required | `hyperbeam.darkmesh.fun` | Allowlist of HB hosts Secrets Worker can sign for | Must be strict allowlist, comma-separated. |
| `REQUIRE_SECRETS` | Required | `1` | Hard-fail boot when secrets missing | Prevent accidental insecure startup. |
| `REQUIRE_METRICS_AUTH` | Required | `1` | Protect metrics endpoint | Never expose metrics unauthenticated in prod. |
| `METRICS_BEARER_TOKEN` | Optional (secret) | none | Bearer auth for metrics scrape | If set, disable basic auth fallback. |

### Secrets Worker bindings (non-env, required)

| Binding | Required | Purpose | Security notes |
|---|---|---|---|
| `REPLAY_LOCKS` (Durable Object) | Required | Nonce one-time replay protection | Do not share across unrelated apps/tenants. |
| `DOMAIN_MAP_KV` (KV/adapter) | Required | Read validated map entries for routing decisions | Read-only path from Secrets Worker perspective preferred. |

---

## Async Worker (async/scheduled) env

| Variable | Required | Default | Purpose | Security notes |
|---|---|---|---|---|
| `MAILER_AUTH_TOKEN` | Required (secret) | none | Legacy internal auth token | Keep while migrating to dedicated jobs token. |
| `JOBS_AUTH_TOKEN` | Required (secret) | none | Auth for `/jobs/*` async endpoints | Use dedicated token; do not reuse mail token long-term. |
| `DM_TXT_NAME` | Optional | `_darkmesh` | TXT record label | Keep fixed per protocol version. |
| `DM_PROTOCOL_VERSION` | Optional | `dm1` | Expected TXT/config version | Reject unknown versions. |
| `DNS_RESOLVER_URL` | Optional | `https://dns.google/resolve` | DNS-over-HTTPS resolver endpoint | Pin resolver host via egress allowlist policy. |
| `AR_GATEWAY_URL` | Optional | `https://arweave.net` | Arweave cfg JSON fetch gateway | Restrict to trusted gateway(s) only. |
| `HB_PROBE_ALLOWLIST` | Required | none | Allowed HB hosts for integrity probe | Required to prevent SSRF/upstream spoofing. |
| `CFG_MAX_BYTES` | Optional | `65536` | Max cfg payload size | Hard cap to prevent memory abuse. |
| `CFG_FETCH_TIMEOUT_MS` | Optional | `2500` | HTTP timeout for cfg/DNS fetch | Keep low to protect budgets. |
| `HB_PROBE_TIMEOUT_MS` | Optional | `2500` | Timeout for HB integrity probe | Avoid long hangs during refresh batches. |
| `REFRESH_DOMAINS` | Required | none | Comma-separated domain cohort for scheduled refresh | Keep explicit; no wildcard expansion. |
| `REFRESH_BATCH_LIMIT` | Optional | `10` | Domains processed per scheduled batch | Tune conservatively for free-tier quotas. |
| `REFRESH_JITTER_SEC` | Optional | `30` | Jitter to desynchronize cron bursts | Required in multi-tenant runs. |
| `HARD_TTL_SEC` | Optional | `3600` | Hard max validity for map entries | Must override excessive user TXT ttl. |
| `STALE_GRACE_SEC` | Optional | `300` | Grace window for stale-if-error | Keep short to reduce takeover lag. |
| `NEGATIVE_CACHE_TTL_SEC` | Optional | `120` | Cache invalid hosts/errors | Mitigates cold-path abuse. |
| `REFRESH_WRITE_ENABLED` | Optional | `1` | Allow writing updated map entries | Set `0` for safe freeze during incidents. |
| `OBSERVE_MODE` | Optional | `1` | Compute/validate without enforcing route changes | Initial rollout safety mode. |
| `SHADOW_MODE` | Optional | `0` | Compare shadow decisions to active route | Enable before enforce. |
| `ENFORCE_MODE` | Optional | `0` | Make map-backed decision authoritative | Enable progressively by cohort. |

### Async Worker bindings (non-env, required)

| Binding | Required | Purpose | Security notes |
|---|---|---|---|
| `DOMAIN_MAP_KV` | Required | Store validated host->target map | Use explicit key prefix per environment. |
| `REPLAY_LOCKS` (optional) | Optional | Protect internal signed refresh envelopes | Recommended if manual refresh endpoint is exposed. |

---

## Shared/cross-worker env policy

| Variable | Required | Default | Purpose | Security notes |
|---|---|---|---|---|
| `ENVIRONMENT` | Optional | `production` | Environment marker for logs/alerts | Never branch security logic only on this value. |
| `LOG_LEVEL` | Optional | `info` | Structured logging verbosity | Avoid logging secrets/token fragments. |
| `FEATURE_CANARY_DOMAINS` | Optional | empty | Comma list for phased enforce rollout | Use explicit domain allowlist for canary only. |
| `INCIDENT_READONLY_MODE` | Optional | `0` | Emergency switch to disable state-changing ops | Keep documented in runbook. |

---

## Minimum production set (P0)

### Secrets Worker minimum required

- `WORKER_STRICT_TOKEN_SCOPES=1`
- `AUTH_REQUIRE_SIGNATURE=1`
- `AUTH_REQUIRE_NONCE=1`
- `REQUIRE_SECRETS=1`
- `REQUIRE_METRICS_AUTH=1`
- secrets: `WORKER_AUTH_TOKEN`, `WORKER_READ_TOKEN`, `WORKER_SIGN_TOKEN`, `ROUTE_ASSERT_TOKEN`, `ROUTE_ASSERT_SIGNING_KEY_HEX`, `INTERNAL_CALL_HMAC_SECRET`
- bindings: `REPLAY_LOCKS`, `DOMAIN_MAP_KV`

### Async Worker minimum required

- `DM_PROTOCOL_VERSION=dm1`
- `HB_PROBE_ALLOWLIST` (non-empty)
- `REFRESH_DOMAINS` (non-empty)
- `OBSERVE_MODE=1`, `SHADOW_MODE=0`, `ENFORCE_MODE=0` at first deploy
- `JOBS_AUTH_TOKEN` secret (plus `MAILER_AUTH_TOKEN` until legacy callers are removed)
- binding: `DOMAIN_MAP_KV`

---

## Security baseline checks before enabling enforce

- `ENFORCE_MODE` remains `0` until:
  - allowlists are configured,
  - replay controls are active,
  - assertion TTL is bounded,
  - HB probe checks are passing,
  - rollback switches are tested.
