# Ops Notes (Gateway)

- Endpoint: `/metrics` (Prom text). Protect with `METRICS_BASIC_USER`/`METRICS_BASIC_PASS` or `METRICS_BEARER_TOKEN`; responds 401 if missing when set.
- Integrity operations runbook: `ops/integrity-runbook.md`.
- Resource budgets and limited-hosting guidance: `ops/resource-budgets.md`.
- Default alert thresholds: `ops/alerts.md` (targets `wedos_medium`).
- Profile-specific alert thresholds and tuning notes: `ops/alerts-profiles.md`.
- Compare-integrity operator tool: `npm run ops:compare-integrity` compares two gateway integrity snapshots for drift.
- Multi-gateway matrix compare: `npm run ops:compare-integrity-matrix` supports `pairwise` and `all` drift checks.
- Drift summary helper: `npm run ops:build-drift-alert-summary` turns matrix JSON into a profile-aware alert report.
- Consistency preflight helper: `npm run ops:validate-consistency-preflight -- --urls <CSV> [--mode pairwise|all] [--profile wedos_small|wedos_medium|diskless] [--token <VALUE>|--allow-anon]`.
- Consistency export helper: `npm run ops:export-consistency-report -- --matrix <FILE> --out-dir <DIR> [--profile wedos_small|wedos_medium|diskless] [--prefix <NAME>]` writes `*-drift-report.md` and `*-drift-summary.json`.
- Release sign-off helper: `npm run ops:build-release-evidence-pack` consolidates consistency + evidence artifacts into one release pack.
- AO dependency gate source: `kernel-migration/ao-dependency-gate.json` provides machine-readable P0.1/P1.1/P1.2 status for release gating.
- AO dependency gate validation: `npm run ops:validate-ao-dependency-gate -- --file kernel-migration/ao-dependency-gate.json` checks gate structure and closed-check evidence references.
- Release sign-off checklist generator: `npm run ops:build-release-signoff-checklist -- --pack <release-evidence-pack.json> [--strict]`.
- Release readiness evaluator: `npm run ops:check-release-readiness -- --pack <release-evidence-pack.json> [--strict] [--json]`.
- Evidence bundle scripts: `npm run ops:export-integrity-evidence` and `npm run ops:validate-integrity-attestation` produce and verify the compare/attestation evidence set used for go/no-go checks.
- Bundle indexing/exchange pack: `npm run ops:index-evidence-bundles` and `npm run ops:build-attestation-exchange-pack` for portable review artifacts.
- Schema validation: keep attestation payloads aligned with `ops/schemas/integrity-attestation.schema.json` before archiving the bundle.
- Dashboard focus: `ops/dashboards/gateway-metrics.yml` now includes integrity mirror consistency, rate-limit tuning, and 429 pressure panels so you can spot drift and overload early.
- Key metrics:
  - Cache: `gateway_cache_hit_total`, `gateway_cache_miss_total`, `gateway_cache_expired_total`, `gateway_cache_store_reject_total`, `gateway_cache_store_reject_size_total`, `gateway_cache_store_reject_capacity_total`, `gateway_cache_size`.
  - Webhooks: `gateway_webhook_stripe_verify_fail_total`, `gateway_webhook_paypal_verify_fail_total`, `gateway_webhook_replay_total`, `gateway_webhook_cert_allow_fail_total`, `gateway_webhook_cert_pin_fail_total`, `gateway_webhook_cert_cache_size`.
  - Rate limit: `gateway_ratelimit_blocked_total`, `gateway_ratelimit_pruned_total`, `gateway_ratelimit_buckets`, `gateway_ratelimit_override_count`, `gateway_ratelimit_effective_max_last`.
  - Replay detector: `gateway_webhook_replay_pruned_total`, `gateway_webhook_replay_ttl_ms`, `gateway_webhook_replay_max_keys`.
  - Integrity incidents/state: `gateway_integrity_incident_total`, `gateway_integrity_incident_duplicate_total`, `gateway_integrity_incident_auth_blocked_total`, `gateway_integrity_incident_role_blocked_total`, `gateway_integrity_incident_notify_fail_total`, `gateway_integrity_state_read_total`, `gateway_integrity_mirror_mismatch_total`, `gateway_integrity_mirror_fetch_fail_total`.
  - Integrity audit tracking: `gateway_integrity_audit_seq_from`, `gateway_integrity_audit_seq_to`, `gateway_integrity_audit_lag_seconds`, `gateway_integrity_checkpoint_age_seconds`, `gateway_integrity_audit_stream_anomaly_total`.
- WAL/DLQ (from Write export): see Write dashboards for `write.webhook.dlq_size` and `write.wal.bytes` to spot downstream backlog.
- Cache purge: `/cache/forget` (POST) with `GATEWAY_FORGET_TOKEN` bearer; body `{subject?, key?}`; returns `{removed}`.
- AO hook: configure AO ForgetSubject to POST to `/cache/forget` with the same token to wipe subject-indexed blobs.
- PSP certs: allowlist prefixes `PAYPAL_CERT_ALLOW_PREFIXES`, pins `GW_CERT_PIN_SHA256`, TTL `GW_CERT_CACHE_TTL_MS`; cert cache size exported.
- Diskless mode: `GATEWAY_INTEGRITY_DISKLESS=1` (or `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless`) disables checkpoint file IO and keeps integrity state memory-only.
- Checkpoint age: compare `gateway_integrity_checkpoint_age_seconds` against your max-age policy; stale checkpoints should be treated as absent.
- Scheduled CI consistency smoke: set repo variable `CONSISTENCY_URLS` (optional `CONSISTENCY_MODE`, `GATEWAY_RESOURCE_PROFILE`) and secret `GATEWAY_INTEGRITY_STATE_TOKEN` when state auth is enabled.
- Scheduled consistency preflight: CI now fails fast on missing/invalid `CONSISTENCY_*` config and reports issues in job summary; for public state endpoints only, set `CONSISTENCY_ALLOW_ANON=1`.
- CI release artifact: workflow job `release-evidence-pack` now downloads consistency/evidence artifacts and uploads `release-evidence-pack` (`.md` + `.json`) for sign-off.

## Release drill flow
1. Compare the integrity matrix with `npm run ops:compare-integrity-matrix -- --mode pairwise` or `--mode all`.
2. Export the drift artifacts with `npm run ops:export-consistency-report -- --matrix <FILE> --out-dir <DIR> --profile wedos_medium`.
3. Validate the AO dependency gate with `npm run ops:validate-ao-dependency-gate -- --file kernel-migration/ao-dependency-gate.json`.
4. Build the release evidence pack with `npm run ops:build-release-evidence-pack`.
5. Run the evidence export with `npm run ops:export-integrity-evidence`.
6. Verify the attestation bundle with `npm run ops:validate-integrity-attestation`.
7. Generate the sign-off checklist with `npm run ops:build-release-signoff-checklist -- --pack <release-evidence-pack.json> --strict`.
8. Optionally run machine output check with `npm run ops:check-release-readiness -- --pack <release-evidence-pack.json> --json`.
9. Attach checklist, drift report, and release pack to the release review.

## Production guardrails
- Cache: keep `gateway_cache_size` below the host memory budget with a clear ceiling per deployment tier.
- Rate limit: keep `gateway_ratelimit_buckets` cardinality flat; if it climbs, reduce key granularity before raising limits.
- Replay: keep `gateway_webhook_replay_total` limited to provider retry windows; a rising replay rate usually means duplicate deliveries or clock skew.
- Checkpoints: prefer tmpfs or no-path operation on small hosts, and only restore signed checkpoints that are still fresh.
- Integrity trio: if audit lag, checkpoint staleness, and stream anomalies all rise together, treat AO fetch cadence as the first suspect before widening thresholds.
- When an alert is profile-specific, keep the threshold below the corresponding budget ceiling and tune `for:` windows before raising the numeric trigger.

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
