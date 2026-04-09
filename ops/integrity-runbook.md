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

1. Add new ref to AO authority set (preferred) and publish integrity snapshot update.
2. During propagation, set local overlay env vars with both old/new refs:
   - `GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS=ref-old,ref-new`
   - (same for `ROOT/REPORTER/UPGRADE` when needed)
3. Verify new ref can perform target action (`/integrity/incident`).
4. Remove old ref from AO authority.
5. Remove old ref from local overlay env vars.

If AO snapshot is temporarily unavailable, local `GATEWAY_INTEGRITY_ROLE_*_REFS` keeps the control plane operable.

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

## 5) Metrics and alerting

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
