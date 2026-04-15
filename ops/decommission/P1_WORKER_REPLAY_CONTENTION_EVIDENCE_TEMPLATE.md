# Worker Replay Contention Drill Evidence (Template)

- Date:
- Environment:
- Operator:
- Worker revision:

## Drill parameters

- Base URL:
- Subject:
- Nonce:
- Attempts:
- HMAC enabled: yes/no

## Result summary

- `201` count:
- `409` count:
- `429` count:
- `5xx` count:
- Pass/Fail:

Pass criterion: exactly one `201`, remaining attempts `409`, no `5xx`.

## Investigation notes (if fail)

- Rate limit interference observed: yes/no
- Replay contention anomaly:
- Mitigation steps:

## Artifacts

- JSON report path:
- Raw command transcript:
- Metrics snapshot link:
