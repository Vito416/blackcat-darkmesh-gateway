# Role Signature-Binding Plan (P0)

Date: 2026-04-13

Goal: close the last P0 cross-repo blocker by making `role` part of detached signature trust boundary.

## Execution status

- ✅ Completed in this run.
- Cross-repo strict audit now reports `P0=0`, `P1=0`.
- Evidence file: `ops/decommission/cross-repo-dataflow-audit.json`.

## Current state

- Gateway now enforces contract role for checkout writes (`shop_admin`) and no longer trusts caller-provided role in write envelope.
- Remaining blocker: worker + write signature canonical fields still do not include `role`.

## Required changes

## 1) `blackcat-darkmesh-ao` (worker)

Files:
- `worker/src/index.ts`

Changes:
- Add `role` to `canonicalDetachedMessage(cmd)` between `nonce` and `payload`.
- Extend `/sign` `allowedKeys` with `role` + `Role`.
- Keep replay, size checks, and auth unchanged.

Validation:
- `cd blackcat-darkmesh-ao/worker && npm test` ✅ pass (8 files / 24 tests).

## 2) `blackcat-darkmesh-write` (runtime + signer tooling)

Files:
- `ao/shared/auth.lua`
- `scripts/sign-write.js`
- optional: `scripts/smoke_sign.lua`, `scripts/cli/send_write_command.js`, `scripts/cli/diagnose_message.js`

Changes:
- Add `role` into `canonical_detached_message(msg)` in `ao/shared/auth.lua`.
- Add `role` into `canonicalDetachedMessage(cmd)` in `scripts/sign-write.js`.
- Keep field order exactly aligned with worker implementation.

Validation:
- `lua5.4 scripts/verify/envelope_guard.lua` ✅ skip (signature env not enabled in local shell)
- `lua5.4 scripts/verify/action_validation.lua` ✅ skip (signature env not enabled in local shell)
- `lua5.4 scripts/verify/ingest_smoke.lua` ✅ skip (signature env not enabled in local shell)
- Deterministic signer check: `scripts/sign-write.js` now produces different signatures for same payload when only `role` changes (`role_bound=true`).

## 3) `blackcat-darkmesh-gateway`

Status: already applied.

Files:
- `src/templateApi.ts`

Behavior:
- For write actions, role is enforced from contract policy.
- Caller role is no longer used for signed write envelope role.

Validation:
- `cd blackcat-darkmesh-gateway && npm test -- tests/template-api.test.ts`
- `cd blackcat-darkmesh-gateway && npm run ops:audit-cross-repo-dataflow -- --strict --json`

Result after 1+2+3:
- `ops:audit-cross-repo-dataflow` reports `P0=0`, `P1=0`.

## 4) Deploy/retest sequence

1. Deploy updated worker code (role in canonical + allowlist).
2. Deploy updated write process/module.
3. Run strict deep tests and matrix tests on finalized PID/module.
4. Re-run cross-repo audit and archive JSON under:
   - `ops/decommission/cross-repo-dataflow-audit.json`

## Risk note

This change modifies signature canonical input. Deploy worker + write together (same window) to avoid temporary signature mismatch.
