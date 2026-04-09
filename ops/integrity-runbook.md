# Gateway Integrity Runbook

This runbook covers authority-aware incident controls and signer rotation safety on the gateway side.

## 1) Required baseline

- Configure incident auth token:
  - `GATEWAY_INTEGRITY_INCIDENT_TOKEN=<strong-random-token>`
- Optionally protect state endpoint:
  - `GATEWAY_INTEGRITY_STATE_TOKEN=<strong-random-token>`
- Keep `AO_INTEGRITY_URL` configured so gateway can consume AO authority/policy snapshots.

## 2) Enable role-aware incident gating (recommended)

- Set:
  - `GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF=1`
- Sender includes signer ref:
  - header `x-signature-ref: <ref>` (or body `signatureRef`)
- Role mapping enforced by action:
  - `pause`, `resume` => `emergency` or `root`
  - `ack`, `report` => `reporter`, `emergency`, or `root`

If ref is missing or not authorized, gateway returns:
- `403 {"error":"forbidden_signature_ref"}`

## 3) Rotation-safe rollout pattern

Use overlap windows to rotate refs without downtime:

### Roles

- `root` - emergency override and last-resort recovery.
- `upgrade` - release/rollback authority for integrity state changes.
- `emergency` - pause/resume and incident controls.
- `reporter` - read-only reporting, triage, and audit signaling.

### Overlap window

Rotate one role at a time. Keep old and new refs live until all of the following are true:

1. AO authority snapshot includes the new ref.
2. Gateway local overlay includes both refs for the role.
3. The new ref passes 2 consecutive successful auth checks for the target action.
4. One full AO snapshot refresh has completed after the new ref became visible.

Suggested overlay pattern:

```bash
GATEWAY_INTEGRITY_ROLE_ROOT_REFS=old-root,new-root
GATEWAY_INTEGRITY_ROLE_UPGRADE_REFS=old-upgrade,new-upgrade
GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS=old-emergency,new-emergency
GATEWAY_INTEGRITY_ROLE_REPORTER_REFS=old-reporter,new-reporter
```

### Rollback

Rollback immediately if any of the following happens during overlap:

- the new ref is rejected for the intended action,
- the new ref is accepted for the wrong role,
- incident commands start returning `403 forbidden_signature_ref`,
- AO snapshot and local overlay disagree on the active role set.

Rollback steps:

1. Restore the previous ref as the active ref in AO.
2. Keep the old ref in the local overlay until the next successful snapshot refresh.
3. Remove the new ref from the overlay only after 2 successful checks with the old ref restored.
4. Record the failure reason before the next rotation attempt.

If AO snapshot is temporarily unavailable, local `GATEWAY_INTEGRITY_ROLE_*_REFS` keeps the control plane operable, but the overlap window still applies.

## 4) Incident commands (examples)

Pause:
```bash
curl -sS -X POST "$GW_URL/integrity/incident" \
  -H "authorization: Bearer $GATEWAY_INTEGRITY_INCIDENT_TOKEN" \
  -H "x-signature-ref: sig-emergency-v2" \
  -H "content-type: application/json" \
  -d '{"event":"manual-freeze","action":"pause","severity":"critical","source":"ops"}'
```

Resume:
```bash
curl -sS -X POST "$GW_URL/integrity/incident" \
  -H "authorization: Bearer $GATEWAY_INTEGRITY_INCIDENT_TOKEN" \
  -H "x-signature-ref: sig-emergency-v2" \
  -H "content-type: application/json" \
  -d '{"event":"manual-unfreeze","action":"resume","severity":"high","source":"ops"}'
```

State check:
```bash
curl -sS "$GW_URL/integrity/state" \
  -H "authorization: Bearer $GATEWAY_INTEGRITY_STATE_TOKEN"
```

### Operator helper script

For repeatable incident handling, prefer the helper in `scripts/integrity-incident.js`.

Staging:
```bash
GATEWAY_INTEGRITY_INCIDENT_TOKEN="$STAGING_INCIDENT_TOKEN" \
  node scripts/integrity-incident.js pause --url https://gateway-staging.example.com
```

Production:
```bash
GATEWAY_INTEGRITY_INCIDENT_TOKEN="$PROD_INCIDENT_TOKEN" \
  node scripts/integrity-incident.js report --url https://gateway.example.com \
    --severity high --event integrity-spike --signature-ref sig-emergency-v2
```

State check with a dedicated read token:
```bash
GATEWAY_INTEGRITY_STATE_TOKEN="$STATE_READ_TOKEN" \
  node scripts/integrity-incident.js state --url https://gateway.example.com
```

Token handling guidance:
- use environment variables or a secret manager export in staging/prod
- avoid placing raw tokens directly in shell history or CI logs
- if you need a one-off override, pass `--token-env NAME` instead of `--token VALUE`

## 5) Outage recovery for AO fetch failures

Use this when integrity snapshots stop arriving or checkpoint reads lag behind the active policy.

### Trigger

Treat AO fetch as degraded if any of the following holds:

- 3 consecutive AO fetch attempts fail,
- snapshot age exceeds 2 refresh intervals,
- checkpoint hash or sequence stops advancing for 2 consecutive checks,
- integrity client reports stale or missing policy data.

### Fallback

1. Switch to checkpoint fallback only; do not unpause mutable traffic.
2. Keep the last known-good policy snapshot pinned locally.
3. Continue fetch attempts on the normal cadence with backoff.
4. Keep incident reporting enabled so operators can see the outage path.

### Resume criteria

Resume live AO fetch only when all of the following are true:

- 3 consecutive AO fetches succeed,
- the fetched snapshot matches the last known policy root or a newer approved root,
- checkpoint sequence advances again,
- no integrity auth/role blocks appear for the active refs,
- the gateway has observed one complete healthy cycle after fallback.

Only after those checks pass may the gateway leave fallback mode and resume normal mutable processing.

## 6) Metrics and alerting

Watch:
- `gateway_integrity_incident_total`
- `gateway_integrity_incident_auth_blocked_total`
- `gateway_integrity_incident_role_blocked_total`
- `gateway_integrity_incident_notify_ok_total`
- `gateway_integrity_incident_notify_fail_total`
- `gateway_integrity_state_read_total`
- `gateway_integrity_state_auth_blocked_total`

Operational interpretation:
- auth blocked spike -> token mismatch or probing.
- role blocked spike -> stale signer refs, wrong role, or attack traffic.
- notify fail spike -> incident relay downstream unavailable.
- fetch failure spike -> AO dependency outage or network path regression.

### Alert -> First Response

| Alert | First response |
| --- | --- |
| `GatewayIntegrityCheckpointStale` | Refresh AO policy first; if the checkpoint is still stale, treat local state as absent and pin the last known-good snapshot until recovery. |
| `GatewayIntegrityAuditLagHigh` | Check AO fetch cadence, queue backpressure, and restore freshness; if this appears with checkpoint stale or anomaly, suspect fetch drift. |
| `GatewayIntegrityAuditStreamAnomaly` | Inspect the last accepted sequence transition for regression or out-of-order delivery before changing any thresholds. |
| `GatewayIntegrityIncidentRoleBlocked` | Verify `x-signature-ref`, role overlay, and recent rotation; confirm the signer is mapped to the intended role before retrying. |
| `GatewayIntegrityStateAuthBlocked` | Verify the state token and scrape path; repeated blocks usually mean probing, a bad secret rollout, or an automation misconfiguration. |
| `GatewayIntegrityIncidentNotifyFail` | Check the downstream notify target/provider health and keep manual triage active until forwarding recovers. |

If checkpoint stale, audit lag, and audit anomaly all fire together, treat it as AO fetch/cadence drift first. If only one fires, start with the layer named in the matrix above.
