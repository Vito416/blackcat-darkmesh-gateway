import { inc, gauge } from './metrics'

const WINDOW_MS = parseInt(process.env.GATEWAY_RL_WINDOW_MS || '60000', 10)
const MAX_REQ = parseInt(process.env.GATEWAY_RL_MAX || '120', 10)

const buckets = new Map<string, { count: number; reset: number }>()

export function check(key: string): boolean {
  const now = Date.now()
  const b = buckets.get(key) || { count: 0, reset: now + WINDOW_MS }
  if (now > b.reset) {
    b.count = 0
    b.reset = now + WINDOW_MS
  }
  b.count++
  buckets.set(key, b)
  gauge('gateway.ratelimit.buckets', buckets.size)
  if (b.count > MAX_REQ) {
    inc('gateway.ratelimit.blocked')
    return false
  }
  return true
}
