# First Production-Like Checklist (VPS VPS)

Use this after Node gateway + cloudflared are up on VPS.

## 0) Service baseline

- `blackcat-gateway.service` is active and listening on `127.0.0.1:8080`.
- `cloudflared.service` is active and tunnel DNS is mapped (`gateway.blgateway.fun` or equivalent).
- Firewall allows only required ingress (tunnel + tailscale/admin path).

## 1) Smoke check

```bash
bash ./prodlike-smoke.sh https://gateway.blgateway.fun
```

Expected:
- `/healthz` returns `ok: true`
- `/template/config` returns gateway/template policy payload
- `/template/call` accepts a read action (200/202/404 based on AO state)

## 2) Deep contract check

```bash
bash ./prodlike-full-suite.sh https://gateway.blgateway.fun
```

Expected:
- Query-string abuse on API routes is blocked
- Unknown action is rejected
- Non-JSON write call is rejected
- Base read call path is stable

## 3) AO/read + write path

- Verify read call goes to AO read path and returns deterministic response.
- Verify one write action goes through gateway -> worker signature boundary -> -write -> AO.
- Confirm replay/nonce/timestamp protections are enforced.

## 4) Untrusted-operator mode sanity

- Keep gateway as untrusted operator boundary.
- Require worker-signed write intent (`require_worker_signature=true`).
- Keep per-site allowlists (`allowed_signature_refs`) and timestamp window checks active.
- If template token mode is used, ensure token rotation plan exists and test rollover once.

## 5) Observability and rollback readiness

- `/metrics` auth is enforced when configured.
- Check logs for deny events and upstream auth failures.
- Keep latest release-drill evidence bundle and rollback command notes in `tmp/` (not committed).
