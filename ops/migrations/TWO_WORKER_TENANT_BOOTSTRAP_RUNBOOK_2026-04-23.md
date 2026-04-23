# Two-worker tenant bootstrap runbook (production)

Date: 2026-04-23  
Status: production bootstrap reference  
Scope: tenant-by-tenant rollout for `secrets-worker` + `async-worker` (no standalone resolver service)

Quick command companion:
- `ops/migrations/TWO_WORKER_TENANT_BOOTSTRAP_COMMANDS_2026-04-23.md`

## Goal

Standardize one safe bootstrap flow for each tenant/domain set:

- workers are tenant-admin owned,
- HyperBEAM remains stock,
- route decisions are promoted only after independent verification,
- rollout can be done without runtime downtime.

## Inputs required per tenant

- Tenant identifier (slug)
- Domain list (for `REFRESH_DOMAINS`)
- Allowed HB hosts (for `HB_ALLOWED_HOSTS` and `HB_PROBE_ALLOWLIST`)
- Arweave gateway policy (`AR_GATEWAY_URL` + `AR_GATEWAY_ALLOWLIST`)
- Secrets Worker URL (for Async Worker): `SECRETS_WORKER_BASE_URL`
- KV namespace id for `DOMAIN_MAP_KV`
- Durable Object migration tag/class for replay locks (Secrets Worker)

## Security baseline

Before deploy, enforce all of the following:

- `WORKER_STRICT_TOKEN_SCOPES=1`
- `AUTH_REQUIRE_SIGNATURE=1`
- `AUTH_REQUIRE_NONCE=1`
- `REQUIRE_SECRETS=1`
- `ROUTE_ASSERT_INTERNAL_HMAC_SECRET` set on both workers (same value)
- no wildcard host allowlists
- no placeholder tokens/secrets

## Step 1: bootstrap Secrets Worker

1. Configure non-secret vars in `workers/secrets-worker/wrangler.toml` under target env.
2. Set required secrets:

```bash
cd workers/secrets-worker

wrangler secret put WORKER_AUTH_TOKEN --env production
wrangler secret put WORKER_READ_TOKEN --env production
wrangler secret put WORKER_SIGN_TOKEN --env production
wrangler secret put ROUTE_ASSERT_TOKEN --env production
wrangler secret put ROUTE_ASSERT_SIGNING_KEY_HEX --env production
wrangler secret put ROUTE_ASSERT_INTERNAL_HMAC_SECRET --env production
```

3. Optional but recommended hardening values:

- `ROUTE_ASSERT_TTL_SEC=120`
- `ROUTE_ASSERT_INTERNAL_HMAC_REQUIRED=1`
- `ROUTE_ASSERT_INTERNAL_HMAC_SKEW_SEC=120`
- `ROUTE_ASSERT_INTERNAL_HMAC_REPLAY_ENABLED=1`
- `ROUTE_ASSERT_INTERNAL_HMAC_REPLAY_TTL_SEC=600`

4. Deploy:

```bash
wrangler deploy --env production
```

5. Smoke check:

```bash
curl -sS https://<secrets-worker-host>/health | jq
```

## Step 2: bootstrap Async Worker

1. Copy template once:

```bash
cd workers/async-worker
cp -n wrangler.toml.example wrangler.toml
```

2. Fill required vars in `wrangler.toml`:

- `REFRESH_DOMAINS`
- `HB_PROBE_ALLOWLIST`
- `DNS_RESOLVER_URL`
- `AR_GATEWAY_URL`
- `AR_GATEWAY_ALLOWLIST`
- `SECRETS_WORKER_BASE_URL`
- `REFRESH_FETCH_TIMEOUT_MS`
- `CONFIG_MAX_BYTES`
- `DNS_RESPONSE_MAX_BYTES`
- `REFRESH_DOMAIN_COOLDOWN_SEC`
- `STALE_GRACE_SEC`

3. Set required secrets:

```bash
wrangler secret put JOBS_AUTH_TOKEN --env production
wrangler secret put MAILER_AUTH_TOKEN --env production
wrangler secret put ROUTE_ASSERT_TOKEN --env production
wrangler secret put ROUTE_ASSERT_INTERNAL_HMAC_SECRET --env production
```

4. Deploy:

```bash
wrangler deploy --env production
```

5. Health and auth smoke check:

```bash
curl -sS https://<async-worker-host>/health | jq

curl -sS -X POST https://<async-worker-host>/jobs/refresh-domain \
  -H "Authorization: Bearer <JOBS_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","reason":"bootstrap_smoke","dryRun":true}' | jq
```

## Step 3: cross-worker assertion path check

Run both worker suites before tenant enablement:

```bash
cd workers/async-worker
npm test -- --run

cd ../secrets-worker
npm test -- --run
```

Minimum acceptance:

- async and secrets suites pass,
- `route-assert` internal signed envelope test passes,
- replay-protection tests pass.

## Step 4: tenant/domain onboarding order

For each domain:

1. Publish DNS `_darkmesh` TXT envelope.
2. Publish signed config JSON on Arweave (`cfg=<tx>` in TXT).
3. Trigger refresh from Async Worker (`/jobs/refresh-domain`).
4. Confirm refresh result code is `ok` and target probe status is `ok`.
5. Only then add domain to canary serving cohort.

Important rule:

- tenant workers can propose metadata,
- route promotion to `valid` requires independent DNS/TXT + config + assertion validation.

## Step 5: phase gates

Use `ops/migrations/TWO_WORKER_PHASE_GATE_EVIDENCE_PACK_2026-04-23.md`.

- Observe: no serving behavior change.
- Shadow: compare decisions and capture mismatch rate.
- Enforce (canary): only after replay drill + rollback drill evidence is attached.

## Rollback

If anomaly detected:

1. Stop tenant refresh updates (disable scheduled refresh trigger or remove tenant from `REFRESH_DOMAINS`).
2. Revert tenant routing to previous known-good path.
3. Rotate:
   - `ROUTE_ASSERT_TOKEN`
   - `ROUTE_ASSERT_INTERNAL_HMAC_SECRET`
   - signing key (`ROUTE_ASSERT_SIGNING_KEY_HEX`) if signature integrity is suspect.
4. Re-enter observe mode and rebuild evidence before re-enable.

## Evidence to keep per tenant

Store under `ops/evidence/two-worker/<date>/<tenant>/`:

- deployed worker versions
- exact env diff (non-secret values only)
- smoke command outputs
- replay drill result
- refresh outcomes for each tenant domain
- rollback proof timestamp (even if not triggered in incident)

## Notes

- This runbook standardizes manual bootstrap and reduces operator variance.
- Full automation (preflight/deploy orchestration) is still a follow-up item.
