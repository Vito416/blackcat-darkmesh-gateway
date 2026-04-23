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

## Tenant worker trust model (critical)

- Workers are spawned and owned by the **domain administrator/tenant**.
- Treat tenant workers as **untrusted input sources** from HyperBEAM perspective.
- HyperBEAM-side routing must not blindly trust worker claims.

Required verification gates before serving:

1. DNS/TXT ownership proof is valid for the requested host.
2. Signed config JSON passes schema + signature + validity-window checks.
3. Secrets Worker assertion/challenge is valid (nonce/TTL/replay safe).
4. Async Worker refresh/probe keeps map state current (`valid|stale|invalid`).

Operational rule:

- A tenant worker can propose routing metadata, but only verified state can be promoted to `valid` and used by hot-path routing.

Bootstrap runbook:

- `ops/migrations/TWO_WORKER_TENANT_BOOTSTRAP_RUNBOOK_2026-04-23.md`
- `ops/migrations/TWO_WORKER_TENANT_BOOTSTRAP_COMMANDS_2026-04-23.md` (copy/paste quick version)

Preflight command:

- `npm run ops:validate-two-worker-bootstrap-preflight`

## HyperBEAM endpoint roles (live)

Use the endpoints below to avoid control-plane/read-plane confusion:

- AO API (read/write): `https://write.darkmesh.fun/`
- Frontend/domain resolve (UI): `https://hyperbeam.darkmesh.fun/`
- Scheduler (this write node): `_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM`
- Variant: `ao.TN.1`

### Common write paths

- Scheduler-direct (existing PID):
  - `POST https://write.darkmesh.fun/~scheduler@1.0/schedule?target=<PID>`
- Module spawn (new PID):
  - `POST https://write.darkmesh.fun/push`

## Write ingress guard (5xx noise reduction)

`write.darkmesh.fun` is routed via nginx write-guard (`127.0.0.1:8745`) before raw HB:

- Blocks common scanner paths.
- Enforces `POST` for `/push` and `/~process@1.0/push` (invalid methods get `405`).
- Reduces avoidable invalid-request 5xx noise on write-style endpoints.

Note: this guard does **not** fix upstream HB internal 5xx classes like intermittent `~cache@1.0/read` failures; those are separate runtime issues.
