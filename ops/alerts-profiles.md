# Gateway Alert Thresholds by Resource Profile

Use this document with `ops/alerts.md` to tune thresholds per deployment profile.

`ops/alerts.md` reflects **WEDOS medium** defaults. For smaller or diskless hosts, replace only the numeric thresholds using the matrix below; do not mix rows across profiles.
Select the profile with `GATEWAY_RESOURCE_PROFILE=wedos_small|wedos_medium|diskless`.

## Threshold matrix

| Signal | WEDOS small (`wedos_small`) | WEDOS medium (`wedos_medium`) | Diskless (`diskless`) |
| --- | ---: | ---: | ---: |
| `gateway_cache_size` high | `> 110` | `> 220` | `> 90` |
| `increase(gateway_cache_store_reject_total[10m])` | `> 10` | `> 20` | `> 8` |
| `gateway_ratelimit_buckets` high | `> 2500` | `> 8500` | `> 1800` |
| `increase(gateway_ratelimit_pruned_total[10m])` | `> 120` | `> 250` | `> 100` |
| `increase(gateway_webhook_replay_total[5m])` | `> 2` | `> 3` | `> 2` |
| `increase(gateway_webhook_replay_total[1m])` | `> 4` | `> 5` | `> 3` |
| `increase(gateway_webhook_replay_pruned_total[10m])` | `> 60` | `> 160` | `> 40` |
| `increase(gateway_integrity_incident_role_blocked_total[10m])` | `> 0` | `> 0` | `> 0` |
| `increase(gateway_integrity_state_auth_blocked_total[5m])` | `> 3` | `> 3` | `> 3` |
| `increase(gateway_integrity_incident_notify_fail_total[10m])` | `> 0` | `> 0` | `> 0` |
| `gateway_integrity_checkpoint_age_seconds` stale | `> 32400` | `> 64800` | `> 21600` |
| `gateway_integrity_audit_lag_seconds` high | `> 1800` | `> 3600` | `> 1200` |
| `increase(gateway_integrity_audit_stream_anomaly_total[15m])` | `> 0` | `> 0` | `> 0` |

## Notes

- Keep thresholds below the hard caps from `ops/resource-budgets.md` so alerts fire before exhaustion.
- Cache thresholds are early warnings; keep them roughly 10-15% below the entry caps.
- If cache rejects are mostly size-based, lower `GATEWAY_CACHE_MAX_ENTRY_BYTES`; if they are mostly capacity-based, lower `GATEWAY_CACHE_MAX_ENTRIES`.
- Rate-limit thresholds should warn before prune becomes continuous; reduce key cardinality before raising caps.
- Replay thresholds cover both volume (`gateway_webhook_replay_total`) and pressure (`gateway_webhook_replay_pruned_total`); if either rises steadily, inspect upstream retry storms or clock skew.
- If replay pruning is rising without a replay spike, shorten `GATEWAY_WEBHOOK_REPLAY_TTL_MS` before raising the key budget.
- Checkpoint age must stay well below `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS`; stale checkpoints are treated as absent, so the alert should fire before the hard cutoff.
- For diskless mode, checkpoint age usually tracks AO snapshot age (file checkpoint is disabled), so keep stale thresholds conservative and favor AO refresh over local retention.
- Audit lag should stay comfortably below the alert threshold; if it climbs, check AO fetch cadence, checkpoint restore freshness, and queue backpressure.
- Audit stream anomalies should page on the first regression, but tune them together with audit lag and checkpoint staleness: if all three move together, treat it as fetch/cadence drift; if anomaly fires alone, inspect stream ordering or a bad seq transition before widening the window.
- Integrity role-blocked, state-auth-blocked, and notify-fail alerts are profile-agnostic control-plane signals; keep their thresholds stable across profiles and use the runbook for the first operator action.
- Integrity fetch jitter (`AO_INTEGRITY_FETCH_RETRY_JITTER_MS`) helps smooth synchronized retries and reduce thundering-herd spikes; keep it near the default 25ms for normal hosts and only raise it if the AO snapshot endpoint is visibly getting bursty retries.
- If your traffic is bursty, increase `for:` windows before increasing numeric thresholds.
