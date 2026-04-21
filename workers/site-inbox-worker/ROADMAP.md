# Worker Roadmap – inbox/notify

## Channels & Limits
- Per-route rate limits (inbox vs notify) with configurable buckets.
- Optional SMS/webhook notify adapter (kept secret-less; tokens in Worker secrets).

## Observability
- Metrics: inbox_put/get/delete counts, ttl_expired, forget_hits, notify_success/fail, rate_limit_hits.
- Alerts: janitor failures, 429 spike, notify failure rate.

## Reliability
- Retry/backoff for notify deliver (webhook/SMTP/SMS) with small queue.
- Idempotent inbox processing: detect duplicate subject+nonce even under retries.

## Security
- Envelope-in-envelope support (double encryption) for PSP secrets in notify.
- HMAC optional on inbox/notify requests; auth token rotation.

## Tooling
- CLI/miniflare script to replay inbox NDJSON for local testing.
- Smoke test fixture for BUSY/resilience under concurrency.

## Next TODO (gateway/Forget integration)
- Add `/forget` hook wired to AO ForgetSubject (Bearer token) to purge subject prefix + replay keys.
- Enforce delete-on-download + SUBJECT_MAX_ENVELOPES + TTL caps; surface metrics for purges/expired.
- Implement `/notify` sender (SendGrid/webhook) without storing payload; rate-limit + retry/backoff.
- Ship Miniflare test that exercises inbox put/get/delete + forget + notify under concurrency.
