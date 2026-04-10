# Gateway Resource Budgets

Use these as deployment guardrails. The numbers below are starting points; tighten them for smaller hosts.

## Recommended profiles

### Profile A: WEDOS small (conservative)
- `GATEWAY_RESOURCE_PROFILE=wedos_small`
- `GATEWAY_CACHE_TTL_MS=180000`
- `GATEWAY_CACHE_MAX_ENTRY_BYTES=131072`
- `GATEWAY_CACHE_MAX_ENTRIES=128`
- `GATEWAY_CACHE_ADMISSION_MODE=reject`
- `GATEWAY_RL_WINDOW_MS=60000`
- `GATEWAY_RL_MAX=80`
- `GATEWAY_RL_MAX_BUCKETS=3000`
- `GATEWAY_WEBHOOK_REPLAY_TTL_MS=600000`
- `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS=3000`
- `GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS=1000`
- `GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES=512`
- `GATEWAY_INTEGRITY_INCIDENT_MAX_BODY_BYTES=16384`
- `GATEWAY_WEBHOOK_MAX_BODY_BYTES=262144`
- `GW_CERT_CACHE_TTL_MS=1800000`
- `GW_CERT_CACHE_MAX_SIZE=128`
- `GW_STRIPE_SIGNATURE_HEADER_MAX_BYTES=2048`
- `AO_INTEGRITY_FETCH_TIMEOUT_MS=4000`
- `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS=2`
- `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS=75`
- `GATEWAY_INTEGRITY_INCIDENT_REPLAY_TTL_MS=900000`
- `GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP=128`
- `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS=43200`

### Profile B: WEDOS medium (balanced default)
- `GATEWAY_RESOURCE_PROFILE=wedos_medium`
- `GATEWAY_CACHE_TTL_MS=300000`
- `GATEWAY_CACHE_MAX_ENTRY_BYTES=262144`
- `GATEWAY_CACHE_MAX_ENTRIES=256`
- `GATEWAY_CACHE_ADMISSION_MODE=reject`
- `GATEWAY_RL_WINDOW_MS=60000`
- `GATEWAY_RL_MAX=120`
- `GATEWAY_RL_MAX_BUCKETS=10000`
- `GATEWAY_WEBHOOK_REPLAY_TTL_MS=600000`
- `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS=10000`
- `GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS=1000`
- `GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES=512`
- `GATEWAY_INTEGRITY_INCIDENT_MAX_BODY_BYTES=16384`
- `GATEWAY_WEBHOOK_MAX_BODY_BYTES=262144`
- `GW_CERT_CACHE_TTL_MS=21600000`
- `GW_CERT_CACHE_MAX_SIZE=256`
- `GW_STRIPE_SIGNATURE_HEADER_MAX_BYTES=4096`
- `AO_INTEGRITY_FETCH_TIMEOUT_MS=5000`
- `AO_INTEGRITY_FETCH_RETRY_ATTEMPTS=3`
- `AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS=100`
- `GATEWAY_INTEGRITY_INCIDENT_REPLAY_TTL_MS=1800000`
- `GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP=256`
- `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS=86400`

### Profile C: Diskless/ephemeral host
- `GATEWAY_RESOURCE_PROFILE=diskless`
- `GATEWAY_INTEGRITY_DISKLESS=1`
- `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless`
- Keep incident replay dedupe bounded (`GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP`) to avoid memory growth on long-lived shared hosts.
- Keep the rest aligned to Profile A or B.

## Webhook verification budget
- `GATEWAY_INTEGRITY_INCIDENT_MAX_BODY_BYTES` bounds JSON incident payloads before auth and validation work starts.
- `GATEWAY_WEBHOOK_MAX_BODY_BYTES` bounds raw Stripe and PayPal payloads before signature verification work starts.
- `GW_CERT_CACHE_TTL_MS` is clamped in code to a sane window, so prefer the profile defaults unless you have a measured PSP rotation reason to deviate.
- `GW_CERT_CACHE_MAX_SIZE` should stay small on shared hosts; large values only make sense when you expect high certificate churn across many tenants.
- `GW_STRIPE_SIGNATURE_HEADER_MAX_BYTES` bounds Stripe header parsing so malformed header bombs fail closed before they can burn CPU.
- For production, combine the cache budget with:
  - `PAYPAL_CERT_ALLOW_PREFIXES` for explicit cert URL allowlisting
  - `GW_CERT_PIN_SHA256` for pinned PSP cert fingerprints
- Stripe signature headers are also bounded in code; if you are seeing rejection here, inspect the sender rather than relaxing the cap.
- Diskless hosts should keep the webhook cache conservative and prefer shorter TTLs only when provider retry windows require it.

## Fetch/retry precedence
- Integrity fetch cadence is resolved in this order:
  1. explicit call overrides (`fetchIntegritySnapshot({ timeoutMs, retryAttempts, retryBackoffMs })`)
  2. env vars (`AO_INTEGRITY_FETCH_*`)
  3. profile defaults from `GATEWAY_RESOURCE_PROFILE`
  4. fallback default profile (`wedos_medium`)
- Use `AO_INTEGRITY_FETCH_*` only when you need a profile-specific exception without changing the whole deployment profile.

## Checkpoint policy
- Restore a signed checkpoint only when it verifies and is within `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS`.
- Treat anything older as missing and refresh from AO instead of stretching local state.
- On diskless or limited-hosting deployments, set `GATEWAY_INTEGRITY_DISKLESS=1` (or `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless`) and keep checkpoint writes disabled.

## Template proxy budget
- `GATEWAY_TEMPLATE_MAX_BODY_BYTES` caps serialized template-call payloads before they reach upstream.
- `GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS` bounds hosted template backend latency; keep it close to the edge timeout budget of the deployment.
- `GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST` should stay narrow on shared or hosted deployments so template traffic only reaches approved upstream hosts.
- If you need to widen any of these, prefer doing it per deployment profile rather than globally.

## Cache budget
- Watch `gateway_cache_size` as the hard memory budget signal for encrypted envelopes and cached artifacts.
- Watch `gateway_cache_admission_mode` to confirm whether the cache is in reject mode (`0`) or LRU eviction mode (`1`).
- Watch reject counters to distinguish pressure source:
  - `gateway_cache_store_reject_size_total`
  - `gateway_cache_store_reject_capacity_total`
- Watch `gateway_cache_evict_lru_total` when using `GATEWAY_CACHE_ADMISSION_MODE=evict_lru`; sustained growth means the host is running near the cache ceiling and the cache is trading retention for admission.
- If cache growth trends upward, shorten `GATEWAY_CACHE_TTL_MS` or tighten admission before scaling host memory.
- Prefer a smaller stable cache over a large, bursty one on edge-class hosts.

## Rate-limit budget
- Watch `gateway_ratelimit_buckets` for cardinality drift.
- Watch `gateway_ratelimit_pruned_total`; sustained growth indicates cap pressure or high key-cardinality churn.
- Keep bucket keys coarse: route plus tenant/session/IP class, not per-request uniqueness.
- If bucket count rises with traffic, collapse keys or reduce tenant fan-out before increasing the limit.

## Replay budget
- Keep replay tracking aligned to provider retry horizons only; the default replay window is 10m.
- Use `gateway_webhook_replay_total`, `gateway_webhook_replay_pruned_total`, and `gateway_webhook_replay_size` to distinguish duplicate delivery storms, prune pressure, and live map growth.
- `GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS` controls how often the detector scans the whole map; keep it near 1000ms on normal hosts, and raise it only when CPU pressure matters more than immediate cleanup.
- `GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES` fails closed on oversized replay keys before they can burn memory or CPU; keep the default unless a real provider key format needs more room.
- Do not extend replay retention on small or diskless hosts unless the provider retry window really requires it.
