import { gauge, inc } from './metrics.js'
import { loadIntegerConfig } from './runtime/config/loader.js'
import { ReplayStore } from './runtime/sessions/replayStore.js'

function readPositiveIntEnv(name: string, fallback: number): number {
  const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
  if (!loaded.ok) return fallback
  if (!Number.isFinite(loaded.value) || loaded.value <= 0) return fallback
  return Math.floor(loaded.value)
}

const ttlMs = readPositiveIntEnv('GATEWAY_WEBHOOK_REPLAY_TTL_MS', 600000) // 10 minutes default
const maxSeen = readPositiveIntEnv('GATEWAY_WEBHOOK_REPLAY_MAX_KEYS', 10000)
const sweepIntervalMs = readPositiveIntEnv('GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS', 1000)
const keyMaxBytes = readPositiveIntEnv('GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES', 512)
const store = new ReplayStore({
  ttlMs,
  maxKeys: maxSeen,
  sweepIntervalMs,
  keyMaxBytes,
})

gauge('gateway_webhook_replay_ttl_ms', ttlMs)
gauge('gateway_webhook_replay_max_keys', maxSeen)
gauge('gateway_webhook_replay_sweep_interval_ms', sweepIntervalMs)
gauge('gateway_webhook_replay_key_max_bytes', keyMaxBytes)
gauge('gateway_webhook_replay_size', store.size)

export function markAndCheck(key: string): boolean {
  const result = store.markAndCheck(key)
  if (result.rejected) {
    inc('gateway_webhook_replay_key_reject')
  }
  if (result.pruned > 0) {
    inc('gateway_webhook_replay_pruned', result.pruned)
  }
  gauge('gateway_webhook_replay_size', result.size)
  if (result.replay) {
    inc('gateway_webhook_replay')
  }
  return result.replay
}
