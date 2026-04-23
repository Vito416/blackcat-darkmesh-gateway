# Worker Scoped Token Rotation Runbook (P1-01)

This runbook rotates strict scoped tokens with zero-downtime overlap.

## Scope

- `WORKER_READ_TOKEN`
- `WORKER_FORGET_TOKEN`
- `WORKER_NOTIFY_TOKEN`
- `WORKER_SIGN_TOKEN`

Strict mode requirement:
- `WORKER_STRICT_TOKEN_SCOPES=1`
- scoped token values must be unique (fail-closed if duplicated)

## Preconditions

- Current deployment is healthy.
- You can call the worker API from an operator machine.
- Old tokens are still available for rollback.

## Rotation sequence

1. Generate 4 new distinct tokens.
2. Update client config first (gateway/ops secrets), but do not flip traffic yet.
3. Write new worker secrets (`wrangler secret put ...`) for all 4 scoped tokens.
4. Deploy worker.
5. Verify endpoint-token pairing (below).
6. Remove old tokens from client side and secret vault notes.

## Endpoint-token verification

Assume:
- `BASE=https://<worker-host>`
- test subject/nonce already exists for read check

### Read token
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $WORKER_READ_TOKEN" \
  "$BASE/inbox/<subject>/<nonce>"
```

### Forget token
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE/forget" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $WORKER_FORGET_TOKEN" \
  -d '{"subject":"rotation-check"}'
```

### Notify token
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE/notify" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $WORKER_NOTIFY_TOKEN" \
  -d '{"to":"ops@example.invalid","subject":"rotation-check","text":"ok","via":"webhook","webhook":"https://httpbin.org/status/200"}'
```

### Sign token
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE/sign" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $WORKER_SIGN_TOKEN" \
  -d '{"action":"Noop","siteId":"rotation-site","role":"admin","tenant":"rotation","requestId":"rotation-sign-1","timestamp":"2026-01-01T00:00:00Z","nonce":"rotation-sign-1","payload":{}}'
```

Expected:
- Correct scoped token -> success code (2xx/expected route result)
- Wrong scoped token -> `401 unauthorized`
- Missing strict scoped token topology -> `500 missing_scoped_token_config` or `500 scoped_tokens_not_unique`

## Rollback

If validation fails:

1. Restore previous 4 scoped tokens.
2. Redeploy worker.
3. Re-run endpoint-token verification.
4. Keep strict mode enabled; do not collapse back to shared token.

## Evidence capture

Record in decommission evidence:

- Timestamped command transcript
- Worker deploy revision
- Verification status table (read/forget/notify/sign)
- Rollback decision (executed/not needed)
