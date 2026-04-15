# P1 Worker Drills — 2026-04-15 (live probe)

Environment:
- Worker base URL: `https://blackcat-inbox-production.vitek-pasek.workers.dev`
- Evidence directory: `ops/decommission/live-probes/2026-04-15/`

## P1-01 scoped token verification (partial)

Artifact:
- `ops/decommission/live-probes/2026-04-15/worker-token-scope-live-2026-04-15.json`

Observed status matrix:
- `read`: token `200`, bad token `404` (non-diagnostic after first successful read consumed the envelope)
- `forget`: token `200`, bad token `401`
- `notify`: token `401`, bad token `401`
- `sign`: token `400`, bad token `401`

Interpretation:
- Route-level auth is working for `forget` and `sign` bad-token checks.
- `notify` currently rejects the provided token (expected if `WORKER_NOTIFY_TOKEN` is distinct from `WORKER_AUTH_TOKEN`).
- This probe is **not** a full rotation drill yet because scoped token values were not rotated live during this run.

## P1-02 replay contention drill (live)

Artifact:
- `../../blackcat-darkmesh-ao/worker/ops/loadtest/reports/replay-contention-live-20260415T155914Z.json`

Observed:
- attempts: `4`
- status counts: `201=3`, `409=1`
- result: `FAIL` (expected: exactly one `201`, the rest `409`)

Interpretation:
- Current live deployment still allows multi-accept replay contention under concurrent same-nonce requests.
- Source fix landed in worker repo: durable-object strong replay lock (`REPLAY_LOCKS` + `REPLAY_STRONG_MODE`), pending deployment.

## Closeout impact

- `P1-01`: remains `[~]` until full scoped-token live rotation evidence is captured.
- `P1-02`: remains `[~]` until worker is redeployed with strong replay lock and drill re-run passes.
