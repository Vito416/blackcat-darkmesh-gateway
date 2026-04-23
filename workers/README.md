# Workers in `blackcat-darkmesh-gateway`

This directory is the canonical runtime home for all Cloudflare Worker flavors used by DarkMesh.

## Worker runtimes

1. `secrets-worker` (production-ready)
   - Per-site secret boundary and signer runtime.
   - Handles inbox/notify/forget/sign/public read bridges.
   - Canonical runtime for secrets/signing boundaries.

2. `async-worker`
   - Optional per-site mail automation/queue worker.
   - Keeps SMTP/API provider credentials in site scope.
   - Must not become long-term PIP database.

## Naming note

Root package scripts use role-based names only:

- `worker:secrets:*`
- `worker:async:*`

## Ownership boundary

- `blackcat-darkmesh-ao`: AO process logic/contracts only.
- `blackcat-darkmesh-write`: shared module + per-site PID runtime.
- `blackcat-darkmesh-gateway/workers`: all worker runtimes and spawn/deploy playbooks.
