# Ops Notes (Gateway)

- Endpoint: `/metrics` (Prom text). Protect with `METRICS_BASIC_USER`/`METRICS_BASIC_PASS` or `METRICS_BEARER_TOKEN`; responds 401 if missing when set.
- Integrity operations runbook: `ops/integrity-runbook.md`.
- Resource budgets and limited-hosting guidance: `ops/resource-budgets.md`.
- Key metrics:
  - Cache: `gateway_cache_hit_total`, `gateway_cache_miss_total`, `gateway_cache_expired_total`, `gateway_cache_store_reject_total`, `gateway_cache_store_reject_size_total`, `gateway_cache_store_reject_capacity_total`, `gateway_cache_size`.
  - Webhooks: `gateway_webhook_stripe_verify_fail_total`, `gateway_webhook_paypal_verify_fail_total`, `gateway_webhook_replay_total`, `gateway_webhook_cert_allow_fail_total`, `gateway_webhook_cert_pin_fail_total`, `gateway_webhook_cert_cache_size`.
  - Rate limit: `gateway_ratelimit_blocked_total`, `gateway_ratelimit_pruned_total`, `gateway_ratelimit_buckets`.
  - Replay detector: `gateway_webhook_replay_pruned_total`, `gateway_webhook_replay_ttl_ms`, `gateway_webhook_replay_max_keys`.
  - Integrity incidents/state: `gateway_integrity_incident_total`, `gateway_integrity_incident_auth_blocked_total`, `gateway_integrity_incident_role_blocked_total`, `gateway_integrity_incident_notify_fail_total`, `gateway_integrity_state_read_total`.
  - Integrity audit tracking: `gateway_integrity_audit_seq_from`, `gateway_integrity_audit_seq_to`, `gateway_integrity_audit_lag_seconds`, `gateway_integrity_checkpoint_age_seconds`.
- WAL/DLQ (from Write export): see Write dashboards for `write.webhook.dlq_size` and `write.wal.bytes` to spot downstream backlog.
- Cache purge: `/cache/forget` (POST) with `GATEWAY_FORGET_TOKEN` bearer; body `{subject?, key?}`; returns `{removed}`.
- AO hook: configure AO ForgetSubject to POST to `/cache/forget` with the same token to wipe subject-indexed blobs.
- PSP certs: allowlist prefixes `PAYPAL_CERT_ALLOW_PREFIXES`, pins `GW_CERT_PIN_SHA256`, TTL `GW_CERT_CACHE_TTL_MS`; cert cache size exported.
- Diskless mode: `GATEWAY_INTEGRITY_DISKLESS=1` (or `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless`) disables checkpoint file IO and keeps integrity state memory-only.
- Checkpoint age: compare `gateway_integrity_checkpoint_age_seconds` against your max-age policy; stale checkpoints should be treated as absent.

## Production guardrails
- Cache: keep `gateway_cache_size` below the host memory budget with a clear ceiling per deployment tier.
- Rate limit: keep `gateway_ratelimit_buckets` cardinality flat; if it climbs, reduce key granularity before raising limits.
- Replay: keep `gateway_webhook_replay_total` limited to provider retry windows; a rising replay rate usually means duplicate deliveries or clock skew.
- Checkpoints: prefer tmpfs or no-path operation on small hosts, and only restore signed checkpoints that are still fresh.

## Prom scrape example
```yaml
scrape_configs:
  - job_name: gateway
    static_configs:
      - targets: ["gateway.local:8787"]
    metrics_path: /metrics
    basic_auth:
      username: ${GATEWAY_METRICS_USER}
      password: ${GATEWAY_METRICS_PASS}
```

## Grafana panel: Worker Notify health
```yaml
title: "Worker Notify"
targets:
  - expr: increase(worker_notify_retry_total[5m])
    legendFormat: retry
  - expr: increase(worker_notify_failed_total[5m])
    legendFormat: failed
  - expr: increase(worker_notify_breaker_open_total[5m])
    legendFormat: breaker_open
  - expr: increase(worker_notify_breaker_blocked_total[5m])
    legendFormat: breaker_blocked
  - expr: increase(worker_notify_deduped_total[5m])
    legendFormat: deduped
```

## Grafana panel: Gateway cache / webhooks / PSP
```yaml
title: "Gateway Cache/Webhooks"
panels:
  - type: timeseries
    title: Cache hit/miss
    targets:
      - expr: rate(gateway_cache_hit_total[5m])
        legendFormat: hit
      - expr: rate(gateway_cache_miss_total[5m])
        legendFormat: miss
      - expr: rate(gateway_cache_expired_total[5m])
        legendFormat: expired
  - type: timeseries
    title: Webhook verify failures
    targets:
      - expr: rate(gateway_webhook_stripe_verify_fail_total[5m])
        legendFormat: stripe_fail
      - expr: rate(gateway_webhook_paypal_verify_fail_total[5m])
        legendFormat: paypal_fail
      - expr: rate(gateway_webhook_replay_total[5m])
        legendFormat: replay
  - type: timeseries
    title: PSP cert issues
    targets:
      - expr: rate(gateway_webhook_cert_allow_fail_total[5m])
        legendFormat: cert_allow_fail
      - expr: rate(gateway_webhook_cert_pin_fail_total[5m])
        legendFormat: cert_pin_fail
      - expr: gateway_webhook_cert_cache_size
        legendFormat: cert_cache_size
```
