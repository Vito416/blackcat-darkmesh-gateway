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

## 7) Cross-gateway attestation bootstrap

Use this when you want to confirm multiple gateways are still aligned before promoting a shared integrity attestation set.

### What to compare

Compare the following fields across the candidate gateways:

- `policy.paused`
- `policy.activeRoot`
- `policy.activePolicyHash`
- `release.version`
- `release.root`
- `audit.seqTo`

### Operator workflow

1. Collect the base URLs of the gateways you want to compare.
2. Reuse a single state token if the gateways share the same auth secret, or pass one token per URL if they do not.
3. Run the comparison helper:

```bash
GATEWAY_INTEGRITY_STATE_TOKEN="$STATE_TOKEN" \
  node scripts/compare-integrity-state.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com
```

4. Treat exit code `0` as ready for attestation bootstrap.
5. Treat exit code `3` as a consistency problem between gateways.
6. Treat exit code `2` as a request or payload failure; re-check connectivity, auth, or the state endpoint.

### Bootstrap guidance

- Run the comparison before rolling a new shared root or policy hash.
- If `policy.activeRoot` or `release.root` diverge, stop and reconcile the active release lineage first.
- If `audit.seqTo` diverges while the policy and release roots match, compare the freshness of the AO snapshot path before promoting the attestation set.
- Keep one operator note per comparison run so the attestation rollout has a clear audit trail.

### Optional attestation artifact

When you need a reviewable artifact for a release or incident packet, generate and archive a JSON attestation after the gateways agree:

```bash
GATEWAY_INTEGRITY_STATE_TOKEN="$STATE_TOKEN" \
  node scripts/generate-integrity-attestation.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com \
    --out ./artifacts/integrity-attestation.json \
    --hmac-env GATEWAY_ATTESTATION_HMAC_KEY
```

Operator notes:
- archive the resulting JSON with the release or incident bundle
- keep the HMAC key out of the archive; store it in the same secret system you use for the state token
- if the script exits `3`, record the mismatch before archiving so the artifact has clear context
- if the script exits `2`, treat the run as incomplete and regenerate after connectivity or payload issues are fixed
- the helper mirrors the compare tool's exit codes, so `0` means aligned, `2` means incomplete, and `3` means drift

## 8) Export -> validate -> dispatch workflow

Use this exact sequence for release evidence, incident packets, and decommission proof.

### 8.1 Export compare + attestation bundle

```bash
mkdir -p ./artifacts/integrity-evidence
GATEWAY_INTEGRITY_STATE_TOKEN="$STATE_TOKEN" \
  node scripts/export-integrity-evidence.js \
    --url https://gateway-a.example.com \
    --url https://gateway-b.example.com \
    --out-dir ./artifacts/integrity-evidence \
    --hmac-env GATEWAY_ATTESTATION_HMAC_KEY
```

### 8.2 Validate the attestation artifact

```bash
node scripts/validate-integrity-attestation.js \
  --file ./artifacts/integrity-evidence/<timestamp>/attestation.json
```

### 8.3 Dispatch the consistency smoke

```bash
GH_TOKEN="$GH_TOKEN" \
  node scripts/dispatch-consistency-smoke.js \
    --owner Vito416 \
    --repo blackcat-darkmesh-gateway \
    --workflow ci.yml \
    --ref feat/gateway-p2-1-hardening-batch \
    --consistency-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --consistency-mode all \
    --consistency-profile wedos_medium \
    --consistency-token "$STATE_TOKEN" \
    --evidence-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --evidence-token "$STATE_TOKEN"
```

Add `--dry-run` first if you want to verify the payload before the live dispatch.

### 8.4 Archive the evidence links

Record these links in the release note, incident packet, or decommission checklist:

- compare bundle path: `./artifacts/integrity-evidence/<timestamp>/compare.txt`
- attestation path: `./artifacts/integrity-evidence/<timestamp>/attestation.json`
- bundle manifest: `./artifacts/integrity-evidence/<timestamp>/manifest.json`
- validation proof: terminal log showing `valid attestation`
- workflow dispatch run URL: GitHub Actions run for the smoke job
- final archive URL: release note, incident packet, or immutable storage link

Pass criteria:
- compare exits `0`
- attestation export exits `0`
- validation exits `0`
- workflow dispatch is accepted and the smoke job finishes green

Fail criteria:
- compare exits non-zero
- attestation export fails or produces a digest mismatch
- validation returns non-zero
- dispatch is rejected or the smoke job fails

## 9) Weekly consistency drill

Run this once per week on the active release branch to confirm the evidence chain still works end to end.

### 9.1 Resolve the latest bundle

```bash
node scripts/latest-evidence-bundle.js \
  --root ./artifacts/integrity-evidence \
  --require-files
```

Pass:
- prints the newest bundle path and the expected artifact files
- exits `0`

Fail:
- exits `3` when no bundle can be resolved
- exits non-zero when required files are missing

### 9.2 Check the bundle

```bash
node scripts/check-evidence-bundle.js \
  --dir ./artifacts/integrity-evidence/<timestamp> \
  --strict
```

Pass:
- prints a valid bundle summary
- exits `0`

Fail:
- exits `3` when manifest or attestation content is inconsistent
- exits `64` on invalid arguments

### 9.3 Index and package evidence

```bash
node scripts/index-evidence-bundles.js \
  --root ./artifacts/integrity-evidence \
  --strict \
  --format json

node scripts/build-attestation-exchange-pack.js \
  --bundle ./artifacts/integrity-evidence/<timestamp> \
  --out ./artifacts/integrity-evidence/attestation-exchange-pack.json
```

Pass:
- bundle index renders with expected rows
- exchange pack is generated and includes an `ok` summary

Fail:
- exits `3` on strict validation errors or malformed content
- exits `64` on invalid CLI usage

### 9.4 Dispatch the smoke

```bash
GH_TOKEN="$GH_TOKEN" \
  node scripts/dispatch-consistency-smoke.js \
    --owner Vito416 \
    --repo blackcat-darkmesh-gateway \
    --workflow ci.yml \
    --ref feat/gateway-p2-1-hardening-batch \
    --consistency-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --consistency-token "$STATE_TOKEN" \
    --evidence-urls https://gateway-a.example.com,https://gateway-b.example.com \
    --evidence-token "$STATE_TOKEN"
```

Pass:
- GitHub accepts the dispatch request
- the smoke workflow starts with the provided URLs

Fail:
- exits non-zero if the token is missing or the API rejects the request
- use `--dry-run` first when validating a new payload shape

Weekly drill checklist:
- `GATEWAY_INTEGRITY_STATE_TOKEN` is populated for compare and validation steps
- `GH_TOKEN` or `GITHUB_TOKEN` is available for the dispatch step
- `GATEWAY_ATTESTATION_HMAC_KEY` is set if the attestation export should be signed
- archive the latest compare, attestation, and workflow run links with the release notes

### 9.5 Weekly automation (CI schedule)

`ci.yml` runs a weekly scheduled consistency smoke (Monday, `03:17` UTC) when `CONSISTENCY_URLS` is configured as a repository variable.

Recommended repo-level config for scheduled runs:
- variable: `CONSISTENCY_URLS` (comma-separated gateway URLs)
- optional variable: `CONSISTENCY_MODE` (`pairwise` or `all`)
- optional variable: `GATEWAY_RESOURCE_PROFILE` (`wedos_small|wedos_medium|diskless`)
- secret: `GATEWAY_INTEGRITY_STATE_TOKEN` (required unless `CONSISTENCY_ALLOW_ANON=1`)
- optional variable: `CONSISTENCY_ALLOW_ANON=1` (only for intentionally public `/integrity/state`)

Preflight behavior:
- schedule runs execute a fail-fast config preflight before comparison
- missing/invalid vars and secret setup are written to the job summary
- preflight blocks the run when required config is missing

The scheduled run uploads:
- matrix JSON output (`compare-integrity-matrix`)
- markdown drift report (`build-drift-alert-summary`)
- JSON drift summary (alert-oriented summary for automation)
