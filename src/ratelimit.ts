import { inc, gauge } from './metrics.js'

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const WINDOW_MS = positiveInt(process.env.GATEWAY_RL_WINDOW_MS, 60000)
const MAX_REQ = positiveInt(process.env.GATEWAY_RL_MAX, 120)
const MAX_BUCKETS = positiveInt(process.env.GATEWAY_RL_MAX_BUCKETS, 10000)

const buckets = new Map<string, { count: number; reset: number }>()

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key)
  }

  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest === undefined) break
    buckets.delete(oldest)
  }
}

export function check(key: string): boolean {
  const now = Date.now()
  prune(now)

  const b = buckets.get(key) || { count: 0, reset: now + WINDOW_MS }
  if (now >= b.reset) {
    b.count = 0
    b.reset = now + WINDOW_MS
  }
  b.count++
  buckets.set(key, b)
  prune(now)
  gauge('gateway_ratelimit_buckets', buckets.size)
  if (b.count > MAX_REQ) {
    inc('gateway_ratelimit_blocked')
    return false
  }
  return true
}

export function _reset() {
  buckets.clear()
  gauge('gateway_ratelimit_buckets', 0)
}
