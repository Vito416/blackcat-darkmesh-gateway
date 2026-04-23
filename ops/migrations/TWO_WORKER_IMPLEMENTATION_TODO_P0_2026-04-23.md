# Two-worker implementation TODO (P0)

Date: 2026-04-23  
Status: execution plan  
Scope: Worker A (runtime/secrets) + Worker B (async/cron)

## Changelog (2026-04-23 sync)

### Landed in this wave

- [x] Worker B DNS/TXT parser and validation pipeline is present (`dnsTxtParser.ts`, `configValidator.ts`).
- [x] Worker B domain map persistence/state-transition modules are present (`domainMapStore.ts`, `domainStateMachine.ts`).
- [x] Worker A route assertion endpoint is wired (`POST /route/assert`).
- [x] Worker B async wiring is present (`/jobs/enqueue`, `/jobs/refresh-domain`, `scheduledHandler`).

### What is next

- [ ] Add Worker B verification of Worker A signed assertions before `valid` promotion.
- [ ] Attach phase-gate evidence bundle (observe/shadow/enforce) with objective thresholds.
- [ ] Finalize production secret/bootstrap runbook for tenant-by-tenant deployment.

### Current blockers

- [ ] Cross-worker replay proof is not yet demonstrated end-to-end in one acceptance run.
- [ ] Canary promotion controls exist but a full evidence log is not yet attached.

## Hard constraints

- **No standalone resolver server**. Resolver responsibilities must live inside Worker A + Worker B.
- Keep HyperBEAM stock image/code (config/runtime wiring only).
- No routing downtime during rollout.
- Fail closed for invalid proofs (no silent fail-open to foreign content).

## Ownership split (explicit)

| Capability | Worker A (edge/secrets) | Worker B (async/refresh) |
|---|---|---|
| Issue short-lived route assertions | owner | consumer |
| Validate DNS TXT + AR cfg | no | owner |
| HB integrity probe + map transition | no | owner |
| Hot-path decision from validated map | owner | no |
| Scheduled jobs / queue handlers | no | owner |
| Internal signed call verification | owner | owner (caller/signing side) |

## Target architecture (P0)

- **Worker A (runtime/secrets)**
  - Issues short-lived signed route assertions.
  - Enforces internal auth, nonce, replay guard for privileged routes.
  - Reads only already-validated map entries for hot-path routing decisions.
- **Worker B (async/scheduled)**
  - Refreshes DNS TXT (`_darkmesh`), fetches AR config JSON, validates signature/time/domain.
  - Performs HB target integrity checks.
  - Writes domain state map (`valid|stale|invalid`) with TTL metadata.

## Parallel execution lanes (6 contributors)

- **Lane 1**: Worker A assertion endpoint + challenge binding
- **Lane 2**: Worker A auth hardening + replay protection
- **Lane 3**: Worker B DNS/TXT + cfg parser/validator pipeline
- **Lane 4**: Worker B HB probe + map state transitions
- **Lane 5**: Rollout flags, observability, dashboards/alerts
- **Lane 6**: End-to-end tests, canary/shadow/enforce acceptance pack

---

## Worker A TODO checklist (runtime/secrets)

### A.1 Assertion API (must)

- [x] Add `POST /route/assert` contract (challenge in, signed assertion out).
- [x] Require `domain`, `cfgTx`, `hbHost`, `challengeNonce`, `challengeExp`.
- [x] Return assertion envelope with `iat`, `exp`, `challengeNonce`, and optional target fields (`siteProcess`, `writeProcess`, `entryPath`).
- [ ] Reject if `hbHost` is not in allowlist.

### A.2 Signature and key controls (must)

- [ ] Sign assertions with dedicated Worker A signing key (not shared with other functions).
- [ ] Include `workerKid` and `sigAlg` in response.
- [ ] Implement key-id pinning against verified config context.
- [ ] Add rotation support (`activeKid`, `nextKid`) and overlap window.

### A.3 Auth and replay defenses (must)

- [ ] Enforce scoped internal token for async->runtime calls.
- [ ] Enforce request timestamp skew ceiling.
- [ ] Enforce nonce one-time usage (replay cache/DO).
- [ ] Return explicit errors (`401`, `403`, `409`) with machine-readable codes.

### A.4 Runtime read behavior (must)

- [ ] Hot path reads only validated domain map entries.
- [ ] Do not perform DNS or AR fetch in Worker A request hot path.
- [ ] If map status `invalid`: fail closed (`404`/`421`).
- [ ] If map status `stale` and inside grace: serve with `stale` marker.

### A.5 Observability (must)

- [ ] Emit metrics: `route_assert_issued_total`, `route_assert_rejected_total`.
- [ ] Emit replay metrics: `route_assert_replay_block_total`.
- [ ] Emit auth metrics by scope and failure reason.
- [ ] Add structured logs with `domain`, `cfgTx`, `workerKid`, decision code.

---

## Worker B TODO checklist (async/scheduled)

### B.1 Refresh scheduler and queueing (must)

- [x] Implement scheduled refresh trigger (cron) with jitter.
- [x] Add manual trigger endpoint `POST /jobs/refresh-domain` (auth-required).
- [ ] Add bounded batch processing and global rate caps.
- [ ] Add per-domain cooldown to prevent hot-loop retries.

### B.2 DNS TXT validation (must)

- [x] Read `_darkmesh.<domain>` TXT.
- [x] Validate envelope: `v=dm1;cfg=<tx>;kid=<addr>;ttl=<sec>`.
- [x] Canonicalize domain (lowercase + punycode + no trailing dot).
- [x] Reject malformed/unknown keys with explicit error codes.

### B.3 AR config validation (must)

- [ ] Fetch cfg JSON from allowlisted Arweave gateway list only.
- [ ] Validate schema fields (`domain`, `siteProcess`, `writeProcess`, `validFrom`, `validTo`, `sig`).
- [ ] Verify signature and `kid` linkage to TXT.
- [ ] Enforce max payload size + timeout budgets.

### B.4 HB integrity checks (must)

- [ ] Probe HB target existence for resolved `siteProcess`/entry path.
- [ ] Validate HB host against allowlist from config/policy.
- [ ] Mark map `invalid` if probe fails or mismatches expected target.
- [ ] Persist `hbVerifiedAt` and probe status reason.

### B.5 Domain map state machine (must)

- [x] Persist map entries: `valid|stale|invalid` + expiry metadata.
- [x] Enforce hard expiry independent from user TXT ttl.
- [x] Implement `stale-if-error` grace window (short, bounded).
- [ ] Implement negative cache for invalid domains.

### B.6 Observability (must)

- [ ] Emit metrics: `dns_refresh_total`, `dns_refresh_error_total`.
- [ ] Emit `cfg_signature_invalid_total`, `hb_probe_fail_total`.
- [ ] Track transitions: `state_valid_total`, `state_stale_total`, `state_invalid_total`.
- [ ] Add refresh latency and cold-path budget metrics.

---

## Shared integration TODO (A <-> B)

- [ ] Define signed internal envelope format (timestamp + nonce + HMAC).
- [ ] Standardize error codes and response envelopes.
- [ ] Standardize map schema version (`mapV1`) and migration strategy.
- [ ] Add contract tests for Worker A/B APIs.
- [ ] Add canary domain list for phase gates.

---

## Rollout order (no downtime)

1. **Preflight**
   - Deploy config flags disabled (`observe=1`, `shadow=0`, `enforce=0`).
   - Verify secrets/bindings are present.
2. **Deploy Worker B first (observe mode)**
   - Run refresh jobs and build map, but do not enforce routing.
3. **Deploy Worker A assertion endpoint (observe mode)**
   - Issue and verify assertions in logs only.
4. **Shadow mode**
   - Enable `shadow=1`: runtime computes decisions from map/assertions and compares to current behavior.
   - Keep existing serving fallback active.
5. **Canary enforce**
   - Enable `enforce=1` for small allowlisted canary domains only.
6. **Progressive enforce**
   - Expand enforce cohort by cohort after SLO checks pass.
7. **Global enforce**
   - Enforce for all enrolled domains.

---

## Rollback order

1. Set `enforce=0` immediately (global fast rollback switch).
2. Keep `shadow=1` for diagnostics (optional), then disable if noisy.
3. Freeze Worker B writes to map (`refresh_write_enabled=0`) if bad data suspected.
4. Re-enable known-good fallback routing path.
5. Invalidate assertion nonce cache if key misuse/replay suspected.
6. Rotate worker keys/tokens if compromise indicators appear.
7. Re-enter `observe` and rerun acceptance suite before next promote.

---

## Acceptance tests by phase

## Phase 1: Observe

- [ ] Existing production routing unchanged (baseline diff == 0 for canary set).
- [ ] Worker B refresh builds map for canary domains with `status=valid`.
- [ ] Worker A can issue assertion for valid domain and reject invalid `hbHost`.
- [ ] No increase in 5xx relative to baseline window.

Pass criteria:
- Control-plane logs complete, no traffic impact, no error spikes.

## Phase 2: Shadow

- [ ] Shadow decision equals current route for >= 99.9% canary requests.
- [ ] Replay test: reused nonce rejected.
- [ ] Tampered cfg signature rejected.
- [ ] HB probe failure sets domain `invalid` and does not mark `valid`.

Pass criteria:
- Decision mismatch rate under threshold, security checks block adversarial cases.

## Phase 3: Enforce

- [ ] Valid domain serves content through map-driven decision path.
- [ ] Invalid domain returns controlled `404/421` (never generic `500`).
- [ ] TXT/cfg change propagates within target SLA.
- [ ] `stale-if-error` works only inside grace; outside grace fails closed.

Pass criteria:
- SLO maintained, no fail-open events, rollback switch validated.

---

## Definition of done (P0)

- [ ] Worker A + Worker B control-plane contracts implemented.
- [ ] DNS/TXT + AR cfg validation and HB integrity checks live.
- [ ] Observe/shadow/enforce phases completed with recorded evidence.
- [ ] Rollback tested and documented.
- [ ] Explicitly confirmed: **no standalone resolver server introduced**.
