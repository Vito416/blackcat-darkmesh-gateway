# Sample Prometheus alerts (Worker)

- alert: WorkerInboxRateLimit
  expr: increase(worker_rate_limit_blocked_total[1m]) > 5
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Worker inbox rate-limit firing"
    description: "Too many inbox requests blocked; check abusive clients or raise thresholds if expected."

- alert: WorkerNotifyRateLimit
  expr: increase(worker_notify_rate_blocked_total[5m]) > 3
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Notify rate-limit firing"
    description: "Notification relay throttled; review NOTIFY_RATE_MAX/NOTIFY_RATE_WINDOW."

- alert: WorkerInboxReplay
  expr: increase(worker_inbox_replay_total[5m]) > 3
  for: 2m
  labels:
    severity: info
  annotations:
    summary: "Inbox replay attempts detected"
    description: "Repeated duplicate subject+nonce submissions; investigate clients or gateway."

- alert: WorkerInboxExpired
  expr: increase(worker_inbox_expired_total[10m]) > 100
  for: 5m
  labels:
    severity: info
  annotations:
    summary: "Many envelopes expiring in worker"
    description: "High expirations; check TTL settings vs processing latency."

- alert: WorkerNotifyHmacMissing
  expr: increase(worker_metrics_auth_blocked_total[5m]) > 3 and on() (absent_over_time(worker_notify_hmac_optional[5m]) == 0)
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Notify HMAC missing but required"
    description: "Multiple /notify requests unauthenticated; set NOTIFY_HMAC_OPTIONAL=1 if intentionally allowing unsigned."

- alert: WorkerNotifyHmacInvalid
  expr: increase(worker_notify_hmac_invalid_total[5m]) > 0
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Notify HMAC invalid"
    description: "HMAC provided but failed verification; check shared secret rotation."

- alert: WorkerForgetDeletes
  expr: increase(worker_forget_deleted_total[5m]) > 50
  for: 5m
  labels:
    severity: info
  annotations:
    summary: "Frequent forget requests"
    description: "Elevated forget deletions; verify AO/ForgetSubject or abuse."

- alert: WorkerNotifyFailures
  expr: increase(worker_notify_failed_total[5m]) > 0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Notify delivery failures"
    description: "Notification retries exhausted (webhook/SendGrid). Check NOTIFY target health and secrets."

- alert: WorkerNotifyBreakerOpen
  expr: increase(worker_notify_breaker_open_total[5m]) > 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Notify breaker tripped"
    description: "Circuit breaker opened for notify target. Investigate webhook/SendGrid outages."

- alert: WorkerNotifyBreakerOpenStripe
  expr: increase(worker_notify_breaker_open_total_stripe[5m]) > 0
  for: 2m
  labels:
    severity: warning
    provider: stripe
  annotations:
    summary: "Stripe notify breaker tripped"
    description: "Stripe-specific notify circuit opened. Check Stripe webhook/notify target health."

- alert: WorkerNotifyBreakerOpenPayPal
  expr: increase(worker_notify_breaker_open_total_paypal[5m]) > 0
  for: 2m
  labels:
    severity: warning
    provider: paypal
  annotations:
    summary: "PayPal notify breaker tripped"
    description: "PayPal-specific notify circuit opened. Check PayPal webhook/notify target health."

- alert: WorkerNotifyBreakerOpenGoPay
  expr: increase(worker_notify_breaker_open_total_gopay[5m]) > 0
  for: 2m
  labels:
    severity: warning
    provider: gopay
  annotations:
    summary: "GoPay notify breaker tripped"
    description: "GoPay-specific notify circuit opened. Investigate GoPay notify target or rate limits."

- alert: WorkerNotifyBreakerBlockedStripe
  expr: increase(worker_notify_breaker_blocked_total_stripe[5m]) > 5
  for: 5m
  labels:
    severity: warning
    provider: stripe
  annotations:
    summary: "Stripe notify requests blocked"
    description: "Stripe notify calls are being short-circuited by breaker. Check downstream availability."

- alert: WorkerNotifyBreakerBlockedPayPal
  expr: increase(worker_notify_breaker_blocked_total_paypal[5m]) > 5
  for: 5m
  labels:
    severity: warning
    provider: paypal
  annotations:
    summary: "PayPal notify requests blocked"
    description: "PayPal notify calls are being short-circuited by breaker. Check downstream availability."

- alert: WorkerNotifyBreakerBlockedGoPay
  expr: increase(worker_notify_breaker_blocked_total_gopay[5m]) > 5
  for: 5m
  labels:
    severity: warning
    provider: gopay
  annotations:
    summary: "GoPay notify requests blocked"
    description: "GoPay notify calls are being short-circuited by breaker. Check downstream availability."

- alert: WorkerInboxExpiredSpike
  expr: increase(worker_inbox_expired_total[15m]) > 500
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Inbox TTL expirations spiking"
    description: "High number of inbox envelopes expired by janitor; check TTL vs processing lag."

## Scrape example
Bearer (recommended in prod):
```
scrape_configs:
  - job_name: worker
    static_configs:
      - targets: ["<your-worker>.workers.dev"]
    metrics_path: /metrics
    bearer_token: ${METRICS_BEARER_TOKEN}
    scheme: https
```
Basic auth (for local/miniflare):
```
  basic_auth:
    username: ${WORKER_METRICS_USER}
    password: ${WORKER_METRICS_PASS}
```
