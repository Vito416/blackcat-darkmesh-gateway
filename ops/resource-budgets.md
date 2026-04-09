# Gateway Resource Budgets

Use these as deployment guardrails. The numbers below are starting points; tighten them for smaller hosts.

## Recommended profiles

### Profile A: WEDOS small (conservative)
- `GATEWAY_RESOURCE_PROFILE=wedos_small`
- `GATEWAY_CACHE_TTL_MS=180000`
- `GATEWAY_CACHE_MAX_ENTRY_BYTES=131072`
- `GATEWAY_CACHE_MAX_ENTRIES=128`
- `GATEWAY_RL_WINDOW_MS=60000`
- `GATEWAY_RL_MAX=80`
- `GATEWAY_RL_MAX_BUCKETS=3000`
- `GATEWAY_WEBHOOK_REPLAY_TTL_MS=600000`
- `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS=3000`
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
- `GATEWAY_RL_WINDOW_MS=60000`
- `GATEWAY_RL_MAX=120`
- `GATEWAY_RL_MAX_BUCKETS=10000`
- `GATEWAY_WEBHOOK_REPLAY_TTL_MS=600000`
- `GATEWAY_WEBHOOK_REPLAY_MAX_KEYS=10000`
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

## Cache budget
- Watch `gateway_cache_size` as the hard memory budget signal for encrypted envelopes and cached artifacts.
- Watch reject counters to distinguish pressure source:
  - `gateway_cache_store_reject_size_total`
  - `gateway_cache_store_reject_capacity_total`
- If cache growth trends upward, shorten `GATEWAY_CACHE_TTL_MS` or tighten admission before scaling host memory.
- Prefer a smaller stable cache over a large, bursty one on edge-class hosts.

## Rate-limit budget
- Watch `gateway_ratelimit_buckets` for cardinality drift.
- Watch `gateway_ratelimit_pruned_total`; sustained growth indicates cap pressure or high key-cardinality churn.
- Keep bucket keys coarse: route plus tenant/session/IP class, not per-request uniqueness.
- If bucket count rises with traffic, collapse keys or reduce tenant fan-out before increasing the limit.

## Replay budget
- Keep replay tracking aligned to provider retry horizons only; the default replay window is 10m.
- Use `gateway_webhook_replay_total` and `gateway_webhook_replay_pruned_total` to detect duplicate delivery storms vs budget churn.
- Do not extend replay retention on small or diskless hosts unless the provider retry window really requires it.
