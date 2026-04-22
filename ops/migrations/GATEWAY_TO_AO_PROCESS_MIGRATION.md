# Gateway -> AO process migration plan

Date: 2026-04-21

## Goal

Keep gateway runtime as universal HyperBEAM edge while moving gateway business logic into AO/-write process contracts.

Companion execution checklist (P0->P2, cross-repo):  
`ops/migrations/DARKMESH_POLICY_IMPLEMENTATION_CHECKLIST_P0_P2.md`.

## Current architecture target

- Gateway/HB: transport + cache + edge controls only (untrusted boundary).
- AO registry process: site directory, runtime pointers, resolver data, public read plane.
- Write process (per-site PID): signed mutations and write authorization.
- Worker (per-site): signer/secrets boundary only.

## Migration batches

### Batch 1 - AO read plane parity (first)

Move these Node-gateway reads to AO-native handlers with strict envelopes:

1. Site resolve by host:
   - current source: gateway resolver path
   - target AO action: `GetSiteByHost`
2. Route resolve:
   - current source: gateway `/api/public/resolve-route`
   - target AO action: `ResolveSiteRoute`
3. Page payload read:
   - current source: gateway `/api/public/page`
   - target AO action: `GetPageByRoute`

Acceptance:
- `{ status, data|error, code }` envelopes only,
- deterministic 200/4xx/5xx mapping in gateway adapter,
- replay-safe readbacks on selected HB URL.

### Batch 2 - Integrity and state controls

Move integrity state operations from gateway-local logic to AO authoritative stream:

1. Integrity snapshot lookup.
2. Integrity incident append/read.
3. Audit sequence continuity checks.

Acceptance:
- gateway cache marked performance-only,
- AO sequence monotonicity is authoritative.

### Batch 3 - Template/runtime config ownership

Move template/runtime configuration authority from gateway file/env to AO contracts:

1. template variant/runtime pointers from AO registry,
2. gateway only validates + caches signed config snapshots.

Acceptance:
- no gateway-local source of truth for template mapping,
- per-site runtime pointers resolved from AO each cycle.

### Batch 4 - Gateway runtime minimization

After parity:

1. keep only edge controls in gateway:
   - rate-limit,
   - cache,
   - security headers,
   - metrics/health.
2. remove/deprecate gateway business handlers that duplicate AO logic.

Acceptance:
- HyperBEAM+gateway node can run as universal edge without project-specific business forks.

## Immediate next action

Start Batch 1 with strict contract tests for:
- `GetSiteByHost`,
- `ResolveSiteRoute`,
- `GetPageByRoute`,
on the new EU HB endpoint (`https://hyperbeam.<your-domain>`) before any further performance tuning.
