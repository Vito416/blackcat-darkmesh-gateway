# Two-worker tenant bootstrap commands (copy/paste)

Date: 2026-04-23  
Status: operator quick commands

## 0) Preflight config check

```bash
cd blackcat-darkmesh-gateway
npm run ops:validate-two-worker-bootstrap-preflight
```

Strict mode (warnings fail):

```bash
npm run ops:validate-two-worker-bootstrap-preflight -- --strict
```

## 1) Secrets Worker - set secrets + deploy

```bash
cd blackcat-darkmesh-gateway/workers/secrets-worker

wrangler secret put WORKER_AUTH_TOKEN --env production
wrangler secret put WORKER_READ_TOKEN --env production
wrangler secret put WORKER_SIGN_TOKEN --env production
wrangler secret put ROUTE_ASSERT_TOKEN --env production
wrangler secret put ROUTE_ASSERT_SIGNING_KEY_HEX --env production
wrangler secret put ROUTE_ASSERT_INTERNAL_HMAC_SECRET --env production

wrangler deploy --env production
```

Health check:

```bash
curl -sS https://<secrets-worker-host>/health | jq
```

## 2) Async Worker - prepare config + set secrets + deploy

```bash
cd blackcat-darkmesh-gateway/workers/async-worker
cp -n wrangler.toml.example wrangler.toml
```

Set required secrets:

```bash
wrangler secret put JOBS_AUTH_TOKEN --env production
wrangler secret put MAILER_AUTH_TOKEN --env production
wrangler secret put ROUTE_ASSERT_TOKEN --env production
wrangler secret put ROUTE_ASSERT_INTERNAL_HMAC_SECRET --env production

wrangler deploy --env production
```

Health check:

```bash
curl -sS https://<async-worker-host>/health | jq
```

## 3) Trigger one dry-run refresh (auth path smoke)

```bash
curl -sS -X POST https://<async-worker-host>/jobs/refresh-domain \
  -H "Authorization: Bearer <JOBS_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","reason":"bootstrap_smoke","dryRun":true}' | jq
```

## 4) Run worker test gates

```bash
cd blackcat-darkmesh-gateway
npm run worker:async:test
npm run worker:secrets:test
```

## 5) Optional shell secret preflight

If you export required secrets to current shell, validate them too:

```bash
cd blackcat-darkmesh-gateway
npm run ops:validate-two-worker-bootstrap-preflight -- --check-secrets-env --strict
```

## References

- Full runbook: `ops/migrations/TWO_WORKER_TENANT_BOOTSTRAP_RUNBOOK_2026-04-23.md`
- Phase gates: `ops/migrations/TWO_WORKER_PHASE_GATE_EVIDENCE_PACK_2026-04-23.md`
