# Cross-Repo Completeness Matrix

Date: 2026-04-13
Scope: `blackcat-darkmesh-write`, `blackcat-darkmesh-ao`, `blackcat-darkmesh-ao/worker`, `blackcat-darkmesh-gateway`

## Reading Guide

- `implemented` means the capability already exists in-repo and has a concrete verification path.
- `missing` means the capability is still open for live rollout, drift-proofing, or evidence closure.
- `priority` uses `P0` for must-close, `P1` for near-term hardening, and `P2` for nice-to-have.
- `owner` names the repo or operating team that should own the next action.
- `verification command` is the best single command or command chain to prove the row.

## Production-Ready Matrix

| area | implemented | missing | priority | owner | verification command |
| --- | --- | --- | --- | --- | --- |
| write | Signed command pipeline, replay/nonce defenses, deploy + rollback runbooks, health/preflight checks, and Arweave hash gating are already documented and wired. | Live canary trace propagation and versioned bridge-contract checks still need to be standardized across the full path. | P0 | `blackcat-darkmesh-write` / write ops | `cd blackcat-darkmesh-write && RUN_CONTRACTS=1 RUN_CONFLICTS=1 bash scripts/verify/preflight.sh && LUA_PATH="?.lua;?/init.lua;ao/?.lua;ao/?/init.lua" lua scripts/verify/health.lua` |
| ao | Signed ingest, integrity rollout checkpoints, AO deploy notes, and health/preflight checks are in place for the registry/process side. | Final registry actions, immutable audit commitment query surface, and the last authority lifecycle closeout still need the final release-grade evidence bundle. | P0 | `blackcat-darkmesh-ao` / AO ops | `cd blackcat-darkmesh-ao && RUN_DEPS_CHECK=1 scripts/verify/preflight.sh && LUA_PATH="?.lua;?/init.lua;ao/?.lua;ao/?/init.lua" lua scripts/verify/health.lua && npm test` |
| worker | Inbox TTL/delete-on-download, secret-backed signer/notification boundary, `/sign` + `/notify`, metrics auth, and stress tests already exist. | Live per-site secret maps, rotation-drill evidence, and production traffic proof for the current deployment envelope are still missing. | P0 | `blackcat-darkmesh-ao/worker` / site ops | `cd blackcat-darkmesh-ao/worker && npm test && npm run test:stress` |
| gateway | Template backend contract, worker-routing/signatureRef coherence, strict release-drill tooling, hosting readiness checks, and decommission gates are already implemented. | Real live-endpoint drift proof, manual closeout proofs, and end-to-end trace propagation still need to land before final confidence is complete. | P0 | `blackcat-darkmesh-gateway` / gateway ops | `cd blackcat-darkmesh-gateway && npm run ops:audit-all && npm run ops:check-production-readiness -- --json && npm run ops:validate-hosting-readiness -- --profile vps_medium --strict --json` |

## Future-Proof Matrix

| area | implemented | missing | priority | owner | verification command |
| --- | --- | --- | --- | --- | --- |
| write | Canonical write deployment already has rollback and finalization steps, and the AO/write boundary is documented in the deploy and rollback runbooks. | Add a stable `x-trace-id` path from gateway to write to AO, and freeze the write-intent policy as a versioned contract. | P1 | `blackcat-darkmesh-write` / write ops | `cd blackcat-darkmesh-write && node scripts/build-write-bundle.js && RUN_CONTRACTS=1 RUN_CONFLICTS=1 bash scripts/verify/preflight.sh` |
| ao | The AO runbooks already define finalization checkpoints, rollback triggers, and the live integrity workflow. | Add versioned publish/revoke/query/pause contract checks and make the audit-commitment stream machine-verifiable across releases. | P1 | `blackcat-darkmesh-ao` / AO ops | `cd blackcat-darkmesh-ao && AUTH_REQUIRE_SIGNATURE=0 AUTH_REQUIRE_NONCE=0 LUA_PATH="?.lua;?/init.lua;ao/?.lua;ao/?/init.lua" lua scripts/verify/contracts.lua && LUA_PATH="?.lua;?/init.lua;ao/?.lua;ao/?/init.lua" lua scripts/verify/health.lua` |
| worker | Worker secret boundaries are explicit, and the repo already has stress/load testing plus operational env guidance. | Add a versioned `/sign` contract, secret-map rotation drill evidence, and a stronger live deployment assertion for the current site set. | P1 | `blackcat-darkmesh-ao/worker` / worker owners | `cd blackcat-darkmesh-ao/worker && npm test && npm run test:stress` |
| gateway | Gateway already validates worker routing, signature refs, and release-drill artifacts, and the profile docs define bounded resource profiles. | Add `x-trace-id` propagation, a signed template-config snapshot, and versioned bridge-contract checks in CI. | P1 | `blackcat-darkmesh-gateway` / gateway ops | `cd blackcat-darkmesh-gateway && npm run ops:check-template-worker-map-coherence -- --require-token-map --require-signature-map --strict --json && npm run ops:check-template-variant-map -- --require-sites site-alpha,site-beta --strict --json` |

## Nice-to-Have Matrix

| area | implemented | missing | priority | owner | verification command |
| --- | --- | --- | --- | --- | --- |
| write | The write repo already has the core deploy and rollback primitives for AO module/PID promotion. | Add a canary routing helper and a repeatable live performance snapshot per host class. | P2 | `blackcat-darkmesh-write` / release ops | `cd blackcat-darkmesh-write && RUN_CONTRACTS=1 RUN_CONFLICTS=1 bash scripts/verify/preflight.sh` |
| ao | AO already has clear deploy and incident guidance plus integrity rollout notes. | Add a more operator-friendly drift summary for slow-path recovery and a reusable evidence export pack. | P2 | `blackcat-darkmesh-ao` / AO ops | `cd blackcat-darkmesh-ao && RUN_DEPS_CHECK=1 scripts/verify/preflight.sh` |
| worker | The worker repo already exposes smoke, stress, and deployment commands for production-like runs. | Add a dedicated rotation checklist for per-site secrets and a single-command prod smoke wrapper. | P2 | `blackcat-darkmesh-ao/worker` / site ops | `cd blackcat-darkmesh-ao/worker && npm test && npm run test:stress` |
| gateway | Gateway already ships rollback helpers, release-drill artifacts, profile tuning, and live drill tooling. | Add a changelog generator for template-variant releases, a one-shot variant rollback helper, and per-VPS-tier load snapshots. | P2 | `blackcat-darkmesh-gateway` / gateway ops | `cd blackcat-darkmesh-gateway && npm run ops:build-template-variant-fallback-map -- --help && npm run ops:validate-hosting-readiness -- --profile vps_small --strict --json` |

## Deploy Order

1. `write` first: publish/finalize the write module and PID so the canonical mutation path is stable before any edge cutover.
2. `ao` second: finalize the AO registry/process side so the read state and authority lifecycle are locked before the gateway exposes them.
3. `worker` third: load the per-site signer and secret maps, then confirm `/sign`, `/notify`, and metrics auth before opening edge traffic.
4. `gateway` last: flip live traffic only after the upstreams, worker routing, and rollback anchors are already in place.

## Rollback Checkpoints

- `write` rollback checkpoint: keep `AO_WRITE_MODULE_PREV` and `AO_WRITE_PID_PREV` ready before promotion; if the new pair misbehaves, restore the previous module/PID and redeploy the edge consumers.
- `ao` rollback checkpoint: keep the last finalized trusted-root snapshot and the previous AO module/PID; if integrity or authority checks regress, pause mutating traffic and repoint to the last-known-good AO release.
- `worker` rollback checkpoint: keep the previous worker URL/token/signatureRef maps and the old secret material until the new signing path passes; if `/sign` or `/notify` drifts, restore the prior maps before re-enabling writes.
- `gateway` rollback checkpoint: keep the previous gateway build, previous worker maps, and the latest drill artifacts; if live `/template/config`, host binding, or strict drill checks fail, restore the prior gateway artifact and close traffic again.

## VPS Constraints

- Default the gateway to the VPS + Cloudflare Tunnel model, not the retired shared-hosting FTP/PHP bridge.
- Keep `GATEWAY_RESOURCE_PROFILE` bounded to `vps_small`, `vps_medium`, or `diskless`; do not assume large-memory hosts, persistent local disks, or unbounded cache growth.
- Treat local checkpoint storage as optional on small or diskless hosts; stale checkpoints must be treated as absent.
- Keep AO fetch timeouts, retry counts, cache size, replay windows, and webhook body limits conservative enough for shared-VPS capacity.
- Use the live VPS drill commands only after the gateway is bound to loopback and `cloudflared.service` is the public entrypoint.

## Trust Boundaries

- Browser/template code is public; it may call gateway APIs, but it must not receive raw worker secrets or direct AO/write internals.
- Gateway is the policy and routing edge; it validates contracts, enforces host/site binding, and keeps secret-smuggling out of the request path.
- Worker is the secret-bearing boundary; it owns PSP/SMTP/OTP material and performs signing or notification work without exposing the secrets back to the gateway.
- AO is the authoritative read/state boundary; it holds public state, registry metadata, and audit records, but not private keys or transport secrets.
- Write is the canonical mutation boundary; it owns the signed command path, replay/nonce protection, and rollback-safe promotion of the process/module pair.
- Any mixed public/secret flow must split into a public envelope plus a secret-dependent worker step, never a single unbounded request-path hop.

## Action Rule

- If a row is `P0`, close it before opening live traffic.
- If a row is `P1`, schedule it immediately after the first live drill.
- If a row is `P2`, keep it on the future-proof backlog and do not block rollout on it.
