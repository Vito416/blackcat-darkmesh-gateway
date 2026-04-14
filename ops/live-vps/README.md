# Live VPS (VPS) Runbook

Canonical docs for the current production-like VPS model.

## Status

- Canonical runtime is now VPS + Node + Cloudflare Tunnel.
- Public entrypoint should be `https://gateway.blgateway.fun` (or your mapped hostname), with local gateway bound to loopback (`127.0.0.1:8080`).

## Runtime model

- `blackcat-gateway.service` runs the Node gateway process.
- `cloudflared.service` publishes the local gateway over Cloudflare Tunnel.
- AO/-write interactions happen over HTTP APIs; worker remains signer/notification boundary.
- Trust model remains untrusted-operator aware:
  - Gateway operator is not trusted with admin secrets.
  - Site worker signatures and per-site policy controls are authoritative for write intents.

## Day-2 quick checks

```bash
systemctl status blackcat-gateway --no-pager
systemctl status cloudflared --no-pager
curl -fsS https://gateway.blgateway.fun/healthz
```

## Files in this folder

- `LIVE_STRICT_DRILL_COMMANDS.md` - strict pre-live drill commands.
- `local-tools/FIRST_PRODUCTION_LIKE_CHECKLIST.md` - operator checklist for first production-like run.
- `local-tools/prodlike-smoke.sh` - quick smoke checks against a live gateway URL.
- `local-tools/prodlike-deep-check.sh` - deeper API/security contract checks.
- `local-tools/prodlike-full-suite.sh` - smoke + deep checks for one or two hostnames.

If you need to keep temporary operator credentials locally, do it outside git-tracked paths.
