# Ops Notes (Gateway)

- Endpoint: `/metrics` (Prom text). Protect with `METRICS_BASIC_USER`/`METRICS_BASIC_PASS` or `METRICS_BEARER_TOKEN`; responds 401 if missing when set.
- Key metrics:
  - Cache: `gateway_cache_hit_total`, `gateway_cache_miss_total`, `gateway_cache_expired_total`, `gateway_cache_size`.
  - Webhooks: `gateway_webhook_stripe_verify_fail_total`, `gateway_webhook_paypal_verify_fail_total`, `gateway_webhook_replay_total`, `gateway_webhook_cert_allow_fail_total`, `gateway_webhook_cert_pin_fail_total`, `gateway_webhook_cert_cache_size`.
  - Rate limit: `gateway_ratelimit_blocked_total`, `gateway_ratelimit_buckets`.
- Cache purge: `/cache/forget` (POST) with `GATEWAY_FORGET_TOKEN` bearer; body `{subject?, key?}`; returns `{removed}`.
- AO hook: configure AO ForgetSubject to POST to `/cache/forget` with the same token to wipe subject-indexed blobs.
- PSP certs: allowlist prefixes `PAYPAL_CERT_ALLOW_PREFIXES`, pins `GW_CERT_PIN_SHA256`, TTL `GW_CERT_CACHE_TTL_MS`; cert cache size exported.

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
