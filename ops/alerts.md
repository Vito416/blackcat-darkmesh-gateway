# Sample Prometheus alerts for Gateway

Default thresholds below target the `wedos_medium` profile.
For `wedos_small` and `diskless`, use the threshold matrix in `ops/alerts-profiles.md`.
Treat these as early warnings, not hard caps; the matching budget ceilings live in `ops/resource-budgets.md`.

- alert: GatewayCacheLowHitRate
  expr: (gateway_cache_hit_total) / (gateway_cache_hit_total + gateway_cache_miss_total + 1) < 0.3
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Gateway cache hit rate is low"
    description: "Cache efficiency <30%. Investigate TTL, admission, or backend slowness."

- alert: GatewayCacheExpiredSpike
  expr: increase(gateway_cache_expired_total[5m]) > 50
  for: 5m
  labels:
    severity: info
  annotations:
    summary: "Gateway cache expirations spiking"
    description: "High number of expired entries; consider TTL tuning."

- alert: GatewayInboxRateLimit
  expr: increase(gateway_ratelimit_blocked_total[1m]) > 5
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Inbox rate-limit triggered"
    description: "Too many inbox requests are being blocked. Check clients or raise limits if intentional."

- alert: GatewayWebhookVerifyFail
  expr: increase(gateway_webhook_stripe_verify_fail_total[5m]) > 3 or increase(gateway_webhook_paypal_verify_fail_total[5m]) > 3
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Webhook signature verification failing"
    description: "Stripe/PayPal verify failures accumulating. Check secrets/certs/replay window."

- alert: GatewayWebhookReplay
  expr: increase(gateway_webhook_replay_total[5m]) > 3
  for: 2m
  labels:
    severity: info
  annotations:
    summary: "Webhook replay detected"
    description: "Repeated webhook replays; investigate duplicate deliveries and compare against the profile matrix."

- alert: GatewayWebhookReplaySpike
  expr: increase(gateway_webhook_replay_total[1m]) > 5
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: "Webhook replay spike"
    description: "Sudden burst of webhook replays in the last minute; check upstream retry storms or clock skew."

- alert: GatewayReplayStorePruned
  expr: increase(gateway_webhook_replay_pruned_total[10m]) > 160
  for: 10m
  labels:
    severity: info
  annotations:
    summary: "Replay store pruning is elevated"
    description: "Replay detector key budget is under pressure; validate replay TTL, max-key limits, and profile-specific replay thresholds."

- alert: GatewayWebhook5xx
  expr: increase(gateway_webhook_stripe_5xx_total[5m]) > 0 or increase(gateway_webhook_paypal_5xx_total[5m]) > 0 or increase(gateway_webhook_gopay_5xx_total[5m]) > 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Gateway PSP handler returning 5xx"
    description: "Stripe/PayPal/GoPay webhook handler is emitting 5xx responses. Check cert allowlist/pins, downstream notify worker, and provider status."

- alert: GatewayCacheSizeHigh
  expr: gateway_cache_size > 220
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Gateway cache growing large"
    description: "Encrypted envelope cache above the default budget; verify TTL, admission, ForgetSubject hooks, and the profile budget row."

- alert: GatewayCacheAdmissionRejects
  expr: increase(gateway_cache_store_reject_total[10m]) > 20
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Gateway cache admission rejects observed"
    description: "Cache writes are being rejected by size/count limits; inspect traffic patterns and tune budget envs."

- alert: GatewayRatelimitBucketsHigh
  expr: gateway_ratelimit_buckets > 8500
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Rate-limit bucket cardinality is high"
    description: "Bucket count is approaching memory budget; reduce key cardinality or raise the host budget after checking the profile matrix."

- alert: GatewayRatelimitPrunedSpike
  expr: increase(gateway_ratelimit_pruned_total[10m]) > 250
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Rate-limit buckets are being aggressively pruned"
    description: "High prune volume suggests bucket-cap pressure; review key cardinality and RL bucket budget."

- alert: GatewayCacheTTLMisconfigured
  expr: gateway_cache_ttl_ms > 900000 or gateway_cache_ttl_ms < 60000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Gateway cache TTL outside expected range"
    description: "TTL too high (>15m) or too low (<1m). Align with Worker inbox TTL and data retention policy."

- alert: GatewayIntegrityCheckpointStale
  expr: gateway_integrity_checkpoint_age_seconds > 86400
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Integrity checkpoint is stale"
    description: "Signed checkpoint age exceeds the max-age policy; treat it as absent and refresh from AO. Use the profile matrix to alert before the hard cutoff."

- alert: GatewayCertSeen
  expr: increase(gateway_webhook_cert_seen_total[1h]) > 100
  for: 0m
  labels:
    severity: info
  annotations:
    summary: "Many webhook certs observed"
    description: "Monitor for cert churn; may indicate provider rotation or MITM attempts."

- alert: GatewayCertAllowFail
  expr: increase(gateway_webhook_cert_allow_fail_total[10m]) > 5
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Webhook cert URL blocked by allowlist"
    description: "PayPal cert URL not in allowlist prefixes. Check PAYPAL_CERT_ALLOW_PREFIXES."

- alert: GatewayCertPinFail
  expr: increase(gateway_webhook_cert_pin_fail_total[10m]) > 3
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Webhook cert pin mismatch"
    description: "Cert fingerprint not in GW_CERT_PIN_SHA256 pins. Investigate MITM or rotation."

- alert: GatewayMetricsAuthBlocked
  expr: increase(gateway_metrics_auth_blocked_total[5m]) > 3
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Metrics endpoint rejecting scrapes"
    description: "Repeated 401s on /metrics. Check scrape credentials or probe activity."

- alert: GatewayIntegrityIncidentRoleBlocked
  expr: increase(gateway_integrity_incident_role_blocked_total[10m]) > 0
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Integrity incident blocked by role policy"
    description: "Gateway refused incident action due to unauthorized or missing signatureRef."

- alert: GatewayIntegrityAuditLagHigh
  expr: gateway_integrity_audit_lag_seconds > 3600
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Integrity audit lag is high"
    description: "Gateway integrity snapshot/audit appears stale; compare against the profile matrix and AO commit cadence."

- alert: GatewayPSPBreakerOpenStripe
  expr: write_psp_stripe_breaker_open > 0
  for: 1m
  labels:
    severity: warning
    provider: stripe
  annotations:
    summary: "Stripe breaker open (write layer)"
    description: "Write-side Stripe circuit opened; Stripe API failures or configuration issues."

- alert: GatewayPSPBreakerOpenPayPal
  expr: write_psp_paypal_breaker_open > 0
  for: 1m
  labels:
    severity: warning
    provider: paypal
  annotations:
    summary: "PayPal breaker open (write layer)"
    description: "Write-side PayPal circuit opened; check PayPal API/webhook status."

- alert: GatewayPSPBreakerOpenGoPay
  expr: write_psp_gopay_breaker_open > 0
  for: 1m
  labels:
    severity: warning
    provider: gopay
  annotations:
    summary: "GoPay breaker open (write layer)"
    description: "Write-side GoPay circuit opened; investigate GoPay gateway health."

- alert: WorkerNotifyBreakerOpen
  expr: increase(worker_notify_breaker_open_total[5m]) > 0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Worker notify breaker tripped"
    description: "Worker notify circuit opened (webhook/SendGrid failures). Investigate downstream notify target."

- alert: WorkerNotifyDedupedSpike
  expr: increase(worker_notify_deduped_total[10m]) > 20
  for: 5m
  labels:
    severity: info
  annotations:
    summary: "Notify dedupe spike"
    description: "High deduplication rate; possible duplicate events from upstream."

## Scrape example
```
scrape_configs:
  - job_name: gateway
    static_configs:
      - targets: ["gateway.local:8787"]
    metrics_path: /metrics
    basic_auth:
      username: "prom"
      password: "${PROM_PASSWORD}"
    scheme: https # drop if scraping over plain HTTP in dev
```
