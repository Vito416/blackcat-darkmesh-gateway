# Worker Repo Migration (AO -> Gateway)

Date: 2026-04-19

## Decision

Cloudflare worker runtimes are now owned by `blackcat-darkmesh-gateway` under `workers/`.

## Why

- Per-site worker spawn/deploy is an edge/gateway concern.
- AO repo should stay focused on AO process contracts and public state logic.
- Centralized worker ownership reduces operator confusion and split release drift.

## New canonical paths

- `workers/secrets-worker` (migrated runtime from AO worker)
- `workers/async-worker` (optional per-site mailer scaffold)

## Migration state

- AO mirror has been removed.
- Two-worker runtime (`secrets-worker`, `async-worker`) is the only supported worker runtime topology in this repository.
