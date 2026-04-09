// Simple in-memory replay detector with TTL
import { inc } from './metrics.js'

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const ttlMs = positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS, 600000) // 10 minutes default
const maxSeen = positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS, 10000)
const seen = new Map<string, number>()

function sweep(now: number) {
  for (const [k, exp] of seen.entries()) {
    if (exp <= now) seen.delete(k)
  }
}

export function markAndCheck(key: string): boolean {
  const now = Date.now()
  sweep(now)
  const prev = seen.get(key)
  seen.set(key, now + ttlMs)
  while (seen.size > maxSeen) {
    const oldest = seen.keys().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
  if (prev !== undefined) {
    inc('gateway_webhook_replay')
    return true
  }
  return false
}
