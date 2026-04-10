// Simple in-memory replay detector with TTL
import { gauge, inc } from './metrics.js'

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const ttlMs = positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS, 600000) // 10 minutes default
const maxSeen = positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS, 10000)
const sweepIntervalMs = positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS, 1000)
const keyMaxBytes = positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES, 512)
const seen = new Map<string, number>()
const keyEncoder = new TextEncoder()
let lastSweepAt = 0

gauge('gateway_webhook_replay_ttl_ms', ttlMs)
gauge('gateway_webhook_replay_max_keys', maxSeen)
gauge('gateway_webhook_replay_sweep_interval_ms', sweepIntervalMs)
gauge('gateway_webhook_replay_key_max_bytes', keyMaxBytes)
gauge('gateway_webhook_replay_size', seen.size)

function sweep(now: number): number {
  let removed = 0
  for (const [k, exp] of seen.entries()) {
    if (exp <= now) {
      seen.delete(k)
      removed++
    }
  }
  return removed
}

function recordSweep(now: number, force: boolean): number {
  if (!force && now - lastSweepAt < sweepIntervalMs) return 0
  lastSweepAt = now
  const removed = sweep(now)
  if (removed > 0) {
    inc('gateway_webhook_replay_pruned', removed)
    gauge('gateway_webhook_replay_size', seen.size)
  }
  return removed
}

function pruneToCapacity(): number {
  let removed = 0
  while (seen.size >= maxSeen) {
    const oldest = seen.keys().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
    removed++
  }
  if (removed > 0) {
    inc('gateway_webhook_replay_pruned', removed)
    gauge('gateway_webhook_replay_size', seen.size)
  }
  return removed
}

export function markAndCheck(key: string): boolean {
  const now = Date.now()

  if (keyEncoder.encode(key).byteLength > keyMaxBytes) {
    inc('gateway_webhook_replay_key_reject')
    inc('gateway_webhook_replay')
    return true
  }

  if (seen.size >= maxSeen) {
    recordSweep(now, true)
  } else {
    recordSweep(now, false)
  }

  const prev = seen.get(key)
  if (prev !== undefined) {
    if (prev > now) {
      seen.set(key, now + ttlMs)
      inc('gateway_webhook_replay')
      return true
    }

    seen.delete(key)
    gauge('gateway_webhook_replay_size', seen.size)
  }

  pruneToCapacity()

  seen.set(key, now + ttlMs)
  gauge('gateway_webhook_replay_size', seen.size)

  if (prev !== undefined) {
    inc('gateway_webhook_replay')
  }
  return false
}
