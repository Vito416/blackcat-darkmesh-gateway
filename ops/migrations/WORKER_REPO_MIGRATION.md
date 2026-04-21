# Worker Repo Migration (AO -> Gateway)

Date: 2026-04-19

## Decision

Cloudflare worker runtimes are now owned by `blackcat-darkmesh-gateway` under `workers/`.

## Why

- Per-site worker spawn/deploy is an edge/gateway concern.
- AO repo should stay focused on AO process contracts and public state logic.
- Centralized worker ownership reduces operator confusion and split release drift.

## New canonical paths

- `workers/site-inbox-worker` (migrated runtime from AO worker)
- `workers/edge-routing-worker` (ingress HB selection scaffold)
- `workers/site-mailer-worker` (optional per-site mailer scaffold)

## Compatibility mode

`blackcat-darkmesh-ao/worker/` remains as a temporary mirror so existing CI and runbooks keep passing while migration lands.

## Exit criteria for removing AO mirror

1. Gateway CI includes all worker runtime tests and deploy smoke.
2. AO workflows no longer reference local `worker/` paths.
3. Ops runbooks point only to gateway worker paths.
4. One tagged release confirms parity.
