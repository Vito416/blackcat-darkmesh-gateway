# Sample Prometheus alerts for Gateway

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
    description: "Repeated webhook replays; investigate duplicate deliveries."

- alert: GatewayCacheSizeHigh
  expr: gateway_cache_size > 5000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Gateway cache growing large"
    description: "Encrypted envelope cache above 5k entries; verify TTL and ForgetSubject hooks."

- alert: GatewayCertSeen
  expr: increase(gateway_webhook_cert_seen_total[1h]) > 100
  for: 0m
  labels:
    severity: info
  annotations:
    summary: "Many webhook certs observed"
    description: "Monitor for cert churn; may indicate provider rotation or MITM attempts."

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
```
