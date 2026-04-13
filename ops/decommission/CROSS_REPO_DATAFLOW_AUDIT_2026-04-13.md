# Cross-Repo Dataflow Audit (Gateway <-> AO <-> Write <-> Worker)

Date: 2026-04-13  
Scope: `blackcat-darkmesh-gateway`, `blackcat-darkmesh-ao`, `blackcat-darkmesh-write`

## 1) What was audited

- Gateway runtime routing and template backend policy:
  - `src/handler.ts`
  - `src/templateApi.ts`
  - `src/runtime/template/actions.ts`
  - `config/template-backend-contract.json`
- AO read adapter contract:
  - `blackcat-darkmesh-ao/scripts/http/public_api_server.mjs`
- Write checkout adapter contract:
  - `blackcat-darkmesh-write/scripts/http/checkout_api_server.mjs`
- Worker signer/bridge surface:
  - `blackcat-darkmesh-ao/worker/src/index.ts`

Validation executed:
- Gateway tests: `npm test` (106 files, 644 tests, all pass).
- Gateway production-like scripts (local tooling).
- Live probe against `https://gateway.blgateway.fun` (runtime behavior observed).
- Automated cross-repo contract probe:
  - `npm run -s ops:audit-cross-repo-dataflow -- --strict --json`
  - latest result: `ready_with_warnings` (P0=0, P1=0)
  - archived snapshot: `ops/decommission/cross-repo-dataflow-audit.json`

## 2) Current intended dataflow (contract)

### Read flow
1. Template/browser calls Gateway `POST /template/call` with action `public.resolve-route` or `public.get-page`.
2. Gateway validates action/payload against local+contract policy.
3. Gateway forwards to AO read adapter:
   - `POST /api/public/resolve-route`
   - `POST /api/public/page`
4. AO adapter normalizes AO envelope and returns stable HTTP status.

### Write flow
1. Template/browser calls Gateway `POST /template/call` with action `checkout.create-order` or `checkout.create-payment-intent`.
2. Gateway validates payload + role policy + mutation gate.
3. Gateway requests worker signature on canonical write envelope (`POST /sign`).
4. Gateway forwards signed command to Write adapter:
   - `POST /api/checkout/order`
   - `POST /api/checkout/payment-intent`
5. Write adapter submits `Write-Command` to write PID and normalizes result.
6. Write process enforces nonce/timestamp/signature/policy/action validation.

### Worker role
- Trusted signer/secrets boundary (`/sign`, inbox/notify/forget).
- Should not be the business-logic source of template rendering decisions.

## 3) Findings

## P0 blockers (close before calling this production-ready)

1. **Runtime drift on live gateway**
   - Live endpoint still returns legacy `Gateway skeleton` for `/template/config`.
   - Query guard behavior on live does not yet match hardened local code.
   - Impact: operators cannot trust live behavior to match audited repo state.

2. **Write auth trust gap for untrusted-operator model**
   - Contract currently treats checkout writes as `requiredRole=shop_admin` while role is caller-supplied in template call.
   - Current control relies mostly on template token boundary; this does not fully satisfy trust-less/untrusted-operator goals.
   - Impact: authorization semantics are not strongly bound to independently verifiable identity for writes.

3. **Host->site binding is implemented locally but not yet proven on live runtime**
   - `GATEWAY_SITE_ID_BY_HOST_MAP` fail-closed logic exists in `src/handler.ts`.
   - Live runtime/probe still needs explicit confirmation with real host map and mismatch tests.
   - Impact: multi-tenant safety depends on correct live config and rollout discipline.

4. **Read path reliability depends on upstream topology**
   - Live probe observed intermittent read failures (`500/504` style behavior from upstream AO path).
   - Impact: production-like stability remains sensitive to adapter deployment topology and fallback path quality.

5. **Role signature-binding (closed in this run)**
   - Worker canonical detached signature fields now include `role`.
   - Write auth canonical detached verification fields now include `role`.
   - Worker `/sign` allowlist now accepts `role`/`Role`/`Actor-Role`.
   - Impact: role is now cryptographically bound to the signed write command.

- Resolved in this run:
  - gateway write envelope enforces contract role (`shop_admin`) instead of caller-supplied role.
  - cross-repo strict audit rerun is green (`P0=0`, `P1=0`).
  - targeted gateway tests and full AO worker tests are passing.

## P1 high-value hardening

1. Keep `Host -> siteId` allowlist map fail-closed in runtime and add live drift checks for it.
2. Introduce explicit write auth mode for template actions:
   - `public|session|admin|worker-proof` policy per action.
3. Add deterministic end-to-end trace IDs propagated through:
   - gateway -> worker signer -> write adapter -> write PID -> AO result.
4. Add strict upstream mode split:
   - separate auth mode/token config for AO-read vs write-upstream.

## P2 / nice-to-have + future-proof

1. Add signed template-config snapshot (hash + tx references) surfaced at `/template/config`.
2. Add action-level latency SLO counters:
   - `template_call_latency_ms{action,target,status}`
3. Add production chaos probes for AO transport fallbacks with automatic evidence bundle export.
4. Add schema-checked domain/site routing registry export from AO to gateway bootstrap.

## 4) Changes already applied locally in this run

- Hardened gateway route behavior:
  - explicit `GET /template/config` JSON endpoint
  - reject query strings on `/template/config` and `/template/call`
  - unknown paths now return `404 not found` instead of generic `200`.
- Updated production-like local tooling docs/scripts to VPS/cloudflared model.
- Full gateway test suite re-run green after hardening changes.

## 5) Recommended next execution batch

1. Deploy latest gateway build to live VPS (remove runtime drift).
2. Implement and enable `Host -> siteId` fail-closed map in gateway.
3. Keep detached-signature `role` binding in worker + write canonical paths as a regression guard.
4. Keep gateway-side role enforcement tied to contract policy (do not regress to caller-provided role).
5. Re-run strict production-like drill and archive evidence bundle.
6. After P0 close, continue with template rollout:
   - publish gateway-search template variants to AO/AR,
   - wire `GATEWAY_TEMPLATE_VARIANT_MAP`,
   - then integrate in `blackcat-darkmesh-web`.
