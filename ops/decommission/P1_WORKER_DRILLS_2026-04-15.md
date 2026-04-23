# P1 Worker Drills — 2026-04-15 (live probe)

Environment:
- Worker base URL: `https://blackcat-inbox-production.vitek-pasek.workers.dev`
- Evidence directory: `ops/decommission/live-probes/2026-04-15/`
- Final deployed worker version (after replay lock + token scope drill): `e4ab8708-5444-41aa-85a0-38ff844d7160`

## P1-01 scoped token verification (final)

Artifact:
- `ops/decommission/live-probes/2026-04-15/worker-token-scope-live-2026-04-15.json`
- `ops/decommission/live-probes/2026-04-15/worker-token-scope-live-2026-04-15-v4.json`

Final observed status matrix (`v4`):
- `read`: token `404`, bad token `401`
- `forget`: token `200`, bad token `401`
- `notify`: token `200`, bad token `401`
- `sign`: token `200`, bad token `401`

Interpretation:
- Scoped route-token separation is verified live end-to-end:
  - correct token accepted,
  - wrong token rejected with `401`.
- Rotation was applied live for scoped tokens (`WORKER_READ_TOKEN`, `WORKER_FORGET_TOKEN`, `WORKER_NOTIFY_TOKEN`, `WORKER_SIGN_TOKEN`) and validated.

## P1-02 replay contention drill (live)

Artifact:
- `../../workers/secrets-worker/ops/loadtest/reports/replay-contention-live-20260415T155914Z.json`
- `../../workers/secrets-worker/ops/loadtest/reports/replay-contention-live-20260415T161919Z-postdo.json`
- `../../workers/secrets-worker/ops/loadtest/reports/replay-contention-live-20260415T162523Z-postdo-verified.json`

Observed:
- pre-fix attempts: `4`, status counts `201=3`, `409=1` -> `FAIL`
- post-fix attempts: `4`, status counts `201=1`, `409=3` -> `PASS`

Interpretation:
- Replay contention blocker is closed after deploying durable-object replay lock (`REPLAY_LOCKS`) with `REPLAY_STRONG_MODE=1`.

## Closeout impact

- `P1-01`: `DONE` (live scoped token separation + wrong-token rejection confirmed).
- `P1-02`: `DONE` (live replay contention pass criterion met).
