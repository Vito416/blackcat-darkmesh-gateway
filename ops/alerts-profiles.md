# Gateway Alert Thresholds by Resource Profile

Use this document with `ops/alerts.md` to tune thresholds per deployment profile.

`ops/alerts.md` reflects **balanced medium** defaults. For smaller or diskless hosts, replace only the numeric thresholds using the matrix below; do not mix rows across profiles.
Select the profile with `GATEWAY_RESOURCE_PROFILE=wedos_small|wedos_medium|diskless`.

## Threshold matrix

| Signal | constrained small (`wedos_small`) | balanced medium (`wedos_medium`) | Diskless (`diskless`) |
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
| `increase(gateway_integrity_mirror_mismatch_total[10m])` | `> 0` | `> 0` | `> 0` |
| `increase(gateway_integrity_mirror_fetch_fail_total[10m])` | `> 0` | `> 0` | `> 0` |
| `gateway_ratelimit_override_count` missing when expected | `0`* | `0`* | `0`* |

## Profile baseline pack (cadence + thresholds)

Use this pack when you need one profile-specific baseline without cross-reading multiple sections.

| Profile | Fetch/retry cadence | Mirror mismatch/fetch fail | Audit lag | Checkpoint stale |
| --- | --- | --- | --- | --- |
| `wedos_small` | `timeout=4000ms`, `attempts=2`, `backoff=75ms`, `jitter=25ms` | `> 0` over `10m`, `for: 2m` | `> 1800`, `for: 12m` | `> 32400`, `for: 15m` |
| `wedos_medium` | `timeout=5000ms`, `attempts=3`, `backoff=100ms`, `jitter=25ms` | `> 0` over `10m`, `for: 1m` | `> 3600`, `for: 8m` | `> 64800`, `for: 10m` |
| `diskless` | `timeout=4000ms`, `attempts=2`, `backoff=75ms`, `jitter=25ms` | `> 0` over `10m`, `for: 1m` | `> 1200`, `for: 10m` | `> 21600`, `for: 12m` |

## Tuning loop by profile

Use this loop when you are deciding whether to change fetch cadence, alert windows, or both. Start from the profile defaults in `ops/resource-budgets.md`; only override them when the same failure mode survives one full alert window.

| Profile | Watch first | Tune first | Roll back when |
| --- | --- | --- | --- |
| `wedos_small` | `gateway_integrity_audit_lag_seconds`, `gateway_integrity_checkpoint_age_seconds`, `increase(gateway_integrity_mirror_fetch_fail_total[10m])`, `increase(gateway_webhook_replay_pruned_total[10m])` | First raise `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS`; only then increase `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS` if the failures remain transient | Revert to the profile defaults if lag does not drop within one full alert window, or if replay prune / cache reject pressure rises faster than the failure rate falls |
| `wedos_medium` | `gateway_integrity_audit_lag_seconds`, `gateway_integrity_checkpoint_age_seconds`, `increase(gateway_integrity_mirror_fetch_fail_total[10m])`, `increase(gateway_cache_store_reject_total[10m])` | First raise `AO_INTEGRITY_FETCH_RETRY_JITTER_MS`; if the pattern is still bursty, raise `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS` before touching alert thresholds | Revert if the added jitter lowers fetch burstiness but increases checkpoint staleness, or if cache/replay pressure now outruns the retry failures |
| `diskless` | `gateway_integrity_checkpoint_age_seconds`, `gateway_integrity_audit_lag_seconds`, `increase(gateway_integrity_mirror_mismatch_total[10m])`, `increase(gateway_integrity_mirror_fetch_fail_total[10m])` | First raise `AO_INTEGRITY_FETCH_RETRY_JITTER_MS`; keep `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS` low so diskless hosts do not accumulate long retry chains | Revert if the diskless host starts spending more time retrying than checkpointing, or if the mirror mismatch / fetch-fail signals stay flat while checkpoint age keeps climbing |

## Release-week checklist

Use this when a rollout is in flight and you are deciding whether to tighten or relax `for:` windows.

- Watch the release-signoff panels together: `increase(gateway_integrity_mirror_mismatch_total[5m])`, `increase(gateway_integrity_mirror_mismatch_total[15m])`, `increase(gateway_integrity_mirror_fetch_fail_total[5m])`, `increase(gateway_integrity_mirror_fetch_fail_total[15m])`, `gateway_integrity_checkpoint_age_seconds`, `gateway_integrity_audit_lag_seconds`, and `increase(gateway_webhook_replay_pruned_total[10m])`.
- Tighten windows first when mismatch or fetch-fail stays non-zero across both the 5m and 15m trend views, or when checkpoint age and audit lag rise in the same release window.
- Relax windows only after the same signal is flat for one full alert window and the readiness indicators stay below threshold with no matching rise in `increase(gateway_webhook_replay_pruned_total[10m])` or `increase(gateway_cache_store_reject_total[10m])`.
- For strict mirror releases (`AO_INTEGRITY_MIRROR_STRICT=1`), keep the shortest window until the release is clean for one rollout interval; then relax one step at a time before changing numeric thresholds.

## Anti-flap alert windows

Use these as starter `for:` values when you need profile-specific alert rules. They reduce flapping without hiding a real regression. Do not widen all alerts at once; widen the noisiest signal first.

| Signal family | constrained small (`wedos_small`) | balanced medium (`wedos_medium`) | Diskless (`diskless`) |
| --- | --- | --- | --- |
| Mirror mismatch / mirror fetch fail | `for: 2m` | `for: 1m` | `for: 1m` |
| Audit lag | `for: 12m` | `for: 8m` | `for: 10m` |
| Checkpoint stale | `for: 15m` | `for: 10m` | `for: 12m` |
| Webhook replay pressure | `for: 5m` | `for: 5m` | `for: 3m` |
| Role / auth / notify control-plane failures | keep the default short window; only widen after a confirmed retry storm | keep the default short window; only widen after a confirmed retry storm | keep the default short window; only widen after a confirmed retry storm |

## Dashboard to alert map

Use this quick map when a panel is noisy and you need the matching alert name without cross-reading `ops/alerts.md`.

| Dashboard panel | Primary alert |
| --- | --- |
| Integrity fetch retry pressure | `GatewayIntegrityMirrorFetchFail` |
| Release signoff: consistency mismatch / fetch-fail trends | `GatewayIntegrityMirrorMismatch`, `GatewayIntegrityMirrorFetchFail` |
| Release signoff: evidence readiness indicators | `GatewayIntegrityCheckpointStale`, `GatewayIntegrityAuditLagHigh`, `GatewayIntegrityAuditStreamAnomaly` |
| Checkpoint age vs audit lag | `GatewayIntegrityCheckpointStale`, `GatewayIntegrityAuditLagHigh` |

## Notes

- Keep the threshold matrix + profile baseline pack in sync with `tests/profile-tuning-sync.test.ts` and `scripts/build-drift-alert-summary.js`; the guard fails CI when fetch cadence, anti-flap windows, or drift thresholds drift from profile expectations.
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
- Integrity fetch jitter (`AO_INTEGRITY_FETCH_RETRY_JITTER_MS`) helps smooth synchronized retries and reduce thundering-herd spikes; keep it near the default 25ms for normal hosts, and raise it before increasing retry attempts when a profile is noisy.
- Mirror consistency checks are best treated as an early warning unless `AO_INTEGRITY_MIRROR_STRICT=1`; if mirror mismatch or fetch-fail counters start climbing, first verify regional snapshot propagation before tightening the alert threshold.
- For strict mirror deployments, page on the first mismatch or fetch failure and keep the alert window short so you do not mask a multi-region divergence.
- The override-count sanity row is optional: only turn it into an active alert in environments where `GATEWAY_RL_MAX_OVERRIDES` must be present; otherwise leave it as a documentation-only guard.
- If your traffic is bursty, increase `for:` windows before increasing numeric thresholds.
