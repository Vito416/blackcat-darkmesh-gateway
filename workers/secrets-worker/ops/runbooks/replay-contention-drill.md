# Worker Replay Contention Drill (P1-02)

This drill validates replay defense under concurrent same-nonce writes.

## Goal

- Confirm one request is accepted and concurrent duplicates are rejected.
- Verify operational behavior when contention occurs repeatedly.

## Preconditions

- Worker deployed with replay guard enabled (`REPLAY_TTL > 0`).
- Strong replay lock enabled (`REPLAY_STRONG_MODE=1`) with `REPLAY_LOCKS` Durable Object binding configured.
- Prefer `RATE_LIMIT_MAX=0` for the drill to avoid limiter noise.
- Optional: set `INBOX_HMAC_SECRET` when signature verification is enabled.

## Run drill

```bash
cd worker
WORKER_BASE_URL="https://<worker-host>" \
REPLAY_DRILL_ATTEMPTS=4 \
REPLAY_DRILL_SUBJECT="drill-replay-$(date +%s)" \
REPLAY_DRILL_NONCE="collision-1" \
node ops/loadtest/replay-contention-drill.mjs --json
```

Optional artifact output:

```bash
node ops/loadtest/replay-contention-drill.mjs \
  --attempts 4 \
  --out ops/loadtest/reports/replay-contention-$(date +%Y%m%d-%H%M%S).json
```

## Pass criteria

- Exactly one request returns `201`.
- Remaining concurrent requests return `409` with replay message.
- No 5xx responses.

## Failure patterns

- `429` dominant -> rate limit interference; rerun with `RATE_LIMIT_MAX=0`.
- Multiple `201` -> replay guard regression (blocker).
- `500` with topology errors -> token scope config invalid in strict mode.

## Recovery actions

1. Capture failing report JSON.
2. Capture worker logs around replay key (`replay:<subject>:<nonce>`).
3. Re-run with attempts=2 to isolate deterministic race.
4. Escalate as P1 blocker if multi-accept persists.

## Evidence capture

- Drill command + timestamp
- JSON report output
- Pass/fail decision
- Any mitigation applied
