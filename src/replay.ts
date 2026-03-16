// Simple in-memory replay detector with TTL
import { inc } from './metrics'

const ttlMs = parseInt(process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS || '600000', 10) // 10 minutes default
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
  if (prev) {
    inc('gateway_webhook_replay_total')
    return true
  }
  return false
}
