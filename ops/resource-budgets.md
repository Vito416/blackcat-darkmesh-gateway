# Gateway Resource Budgets

Use these as deployment guardrails. The numbers below are starting points; tighten them for smaller hosts.

## Checkpoint policy
- Restore a signed checkpoint only when it verifies and is within `GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS`.
- Treat anything older as missing and refresh from AO instead of stretching local state.
- On diskless or limited-hosting deployments, leave `GATEWAY_INTEGRITY_CHECKPOINT_PATH` unset or mount it on tmpfs.

## Cache budget
- Watch `gateway_cache_size` as the hard memory budget signal for encrypted envelopes and cached artifacts.
- If cache growth trends upward, shorten `GATEWAY_CACHE_TTL_MS` or tighten admission before scaling host memory.
- Prefer a smaller stable cache over a large, bursty one on edge-class hosts.

## Rate-limit budget
- Watch `gateway_ratelimit_buckets` for cardinality drift.
- Keep bucket keys coarse: route plus tenant/session/IP class, not per-request uniqueness.
- If bucket count rises with traffic, collapse keys or reduce tenant fan-out before increasing the limit.

## Replay budget
- Keep replay tracking aligned to provider retry horizons only; the default replay window is 10m.
- Use `gateway_webhook_replay_total` and replay spikes to detect duplicate delivery storms, not as a long-lived state store.
- Do not extend replay retention on small or diskless hosts unless the provider retry window really requires it.
