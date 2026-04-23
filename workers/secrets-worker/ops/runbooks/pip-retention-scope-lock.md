# Worker PIP Retention Scope Lock

This runbook prevents scope drift where the worker accidentally becomes a long-term PIP database.

## Decision (locked)

- Worker KV is an **ephemeral encrypted envelope buffer** only.
- Default retention target is minutes/hours, not days.
- Absolute maximum retention in code is **24h** (`INBOX_TTL_HARD_MAX_SECONDS=86400`).
- `GET /inbox/:subject/:nonce` must remain **delete-on-download**.
- `POST /forget` must remain available as an operator/automation purge path.
- Long-term PIP storage remains offline under site-admin control.

## In-scope vs out-of-scope

In scope:
- `/inbox`, `/inbox/:subject/:nonce`, `/forget`, replay locks, TTL janitor.
- Secret-backed signing/HMAC verification and notification relay.

Out of scope:
- Persistent user-profile/account database in worker KV.
- Long-lived OTP account vault in worker KV.
- Session store intended as source-of-truth for identity.

## Guardrails in code/config

1. TTL hard cap:
   - `src/index.ts` enforces `INBOX_TTL_HARD_MAX_SECONDS=86400`.
2. Read-path purge:
   - `GET /inbox/:subject/:nonce` deletes the envelope after read.
3. Forget purge:
   - `POST /forget` deletes subject and replay keys.
4. Janitor:
   - scheduled cleanup removes expired/malformed entries.
5. Strict tokens:
   - keep `WORKER_STRICT_TOKEN_SCOPES=1` so purge/read/signer boundaries are explicit.

## Review checklist for PRs

Reject PRs that:
- increase hard retention above 24h,
- remove delete-on-download behavior,
- add persistent account/session tables to KV as system-of-record,
- make `/forget` optional for operational purge.

Require security review when:
- adding new secret-bearing endpoints,
- adding new storage bindings (D1/R2/KV namespaces) for PIP payload classes.

## If a future feature needs longer retention

Do not extend worker KV retention by default.

Create a separate design decision first:
1. define data class and legal basis,
2. justify why offline admin custody is not enough,
3. define cryptographic segregation and deletion semantics,
4. define migration/rollback and incident response.

Until approved, keep worker retention ephemeral and bounded.
