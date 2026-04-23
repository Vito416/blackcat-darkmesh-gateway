# Two-worker next actions (2026-04-23)

Date: 2026-04-23  
Status: actionable runbook sync  
Scope: Secrets Worker (edge/secrets) + Async Worker (async/refresh)

## Constraint

- **No standalone resolver server**.
- Continue with two-worker model only.

## Changelog

- 2026-04-23: synchronized worker docs after landed modules (parsers, validators, state machine, route assertion endpoint, async job wiring).

## What is done (objective)

- DNS TXT parsing and strict envelope validation exist in Async Worker.
- Config JSON validation (domain/time window/signature fields) exists in Async Worker.
- Domain map persistence + status transitions (`valid|stale|invalid`) are implemented in Async Worker modules.
- `POST /route/assert` is wired in Secrets Worker.
- Async Worker async control-plane entrypoints are wired (`/jobs/enqueue`, `/jobs/refresh-domain`, `scheduled`).

Done criteria used:
- source modules exist and are referenced by runtime entrypoints,
- endpoints are reachable in routing table,
- no additional resolver service introduced.

## Ownership split

| Responsibility | Secrets Worker (edge/secrets) | Async Worker (async/refresh) |
|---|---|---|
| Route assertion issuance/signing | owner | consumer |
| DNS TXT + AR cfg refresh/validation | no | owner |
| HB integrity probe and state update | no | owner |
| Hot-path route decision from validated map | owner | no |
| Phase progression evidence collection | shared | shared |

## What is next (P0 action queue)

### Secrets Worker actions

1. Enforce challenge-binding verification in assertion responses (nonce, expiry, host).
2. Add explicit replay test coverage for repeated assertions.
3. Emit structured metrics for assertion auth rejects and replay blocks.

Exit criteria:
- failed nonce reuse is rejected deterministically,
- assertion TTL cap is enforced,
- metrics exported for `ok`, `reject`, `replay_block`.

### Async Worker actions

1. Consume and verify Secrets Worker assertion before promoting map status to `valid`.
2. Complete HB probe integration in map transition path (promote only on successful probe).
3. Finalize refresh limits and negative-cache behavior for abuse resistance.

Exit criteria:
- `valid` state requires successful assertion + probe,
- failed probe drives `invalid` (or bounded `stale` only in grace window),
- scheduled jobs respect batch/timeout limits.

### Shared actions

1. Wire phase flags and canary cohorts in one runbook (`observe -> shadow -> enforce`).
2. Produce one acceptance evidence pack per phase.
3. Validate fast rollback (`enforce=0`) within one deployment cycle.

Exit criteria:
- phase transitions are scripted and reproducible,
- rollback execution timestamped with success evidence.

## Blockers and unblocking plan

| Blocker | Impact | Unblocking action | Owner |
|---|---|---|---|
| End-to-end replay proof not captured in one run | Risk in enforce readiness | Add a dedicated replay drill and store output artifact | Secrets Worker |
| No single evidence bundle for canary promotion | Delays phase transition approvals | Produce one markdown + metrics bundle per phase gate | Shared |
| Tenant bootstrap still manual | Slow operator onboarding | Add preflight checklist for required secrets/bindings and fail-fast checks | Async Worker |

## Phase acceptance criteria (operational)

### Observe phase

- Routing behavior unchanged vs baseline.
- Refresh jobs produce deterministic map records for canary domains.
- No new 5xx regression.

### Shadow phase

- Shadow decisions match active behavior within agreed threshold.
- Tampered TXT/cfg/assertion inputs are rejected with explicit codes.
- Replay attempts are blocked.

### Enforce phase

- Valid domains serve normally via two-worker decision path.
- Invalid domains fail closed (`404`/`421`, not generic `500`).
- Rollback switch (`enforce=0`) verified in production-like run.

## Immediate execution order (next wave)

1. Secrets Worker replay + challenge hardening.
2. Async Worker assertion-consumption + HB probe gating.
3. Observe evidence refresh.
4. Shadow canary start.
5. Enforce canary after gates pass.
