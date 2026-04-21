# Workers in `blackcat-darkmesh-gateway`

This directory is the canonical runtime home for all Cloudflare Worker flavors used by DarkMesh.

## Worker flavors

1. `site-inbox-worker` (production-ready)
   - Per-site secret boundary and signer runtime.
   - Handles inbox/notify/forget/sign/public read bridges.
   - Source migrated from `blackcat-darkmesh-ao/worker`.

2. `edge-routing-worker` (scaffold)
   - Shared edge ingress for host -> site resolution.
   - Chooses suitable HyperBEAM target and keeps user domain UX.
   - Should stay stateless/minimal and never store PIP.

3. `site-mailer-worker` (scaffold)
   - Optional per-site mail automation/queue worker.
   - Keeps SMTP/API provider credentials in site scope.
   - Must not become long-term PIP database.

## Ownership boundary

- `blackcat-darkmesh-ao`: AO process logic/contracts only.
- `blackcat-darkmesh-write`: shared module + per-site PID runtime.
- `blackcat-darkmesh-gateway/workers`: all worker runtimes and spawn/deploy playbooks.

## Next migration step

After validation window, remove legacy mirror from `blackcat-darkmesh-ao/worker` and keep this directory as single source of truth.
