import { inc, gauge } from './metrics.js'
import { loadIntegerConfig, loadStringConfig } from './runtime/config/loader.js'

function readPositiveIntEnv(name: string, fallback: number): number {
  const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
  if (!loaded.ok) return fallback
  if (!Number.isFinite(loaded.value) || loaded.value <= 0) return fallback
  return Math.floor(loaded.value)
}

function readStringEnv(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok) return undefined
  const value = typeof loaded.value === 'string' ? loaded.value.trim() : ''
  return value.length > 0 ? value : undefined
}

function positiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseOverrides(raw: string | undefined): Map<string, number> {
  const overrides = new Map<string, number>()
  if (!raw) return overrides

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    const separator = trimmed.indexOf('=')
    if (separator <= 0 || separator === trimmed.length - 1) continue

    const prefix = trimmed.slice(0, separator).trim()
    const max = positiveInt(trimmed.slice(separator + 1).trim(), 0)
    if (!prefix || max <= 0) continue

    overrides.set(prefix, max)
  }

  return overrides
}

const WINDOW_MS = readPositiveIntEnv('GATEWAY_RL_WINDOW_MS', 60000)
const MAX_REQ = readPositiveIntEnv('GATEWAY_RL_MAX', 120)
const MAX_BUCKETS = readPositiveIntEnv('GATEWAY_RL_MAX_BUCKETS', 10000)
const PREFIX_OVERRIDES = parseOverrides(readStringEnv('GATEWAY_RL_MAX_OVERRIDES'))

const buckets = new Map<string, { count: number; reset: number }>()

gauge('gateway_ratelimit_max', MAX_REQ)
gauge('gateway_ratelimit_max_buckets', MAX_BUCKETS)
gauge('gateway_ratelimit_override_count', PREFIX_OVERRIDES.size)

function effectiveMaxForKey(key: string): number {
  const separator = key.indexOf(':')
  if (separator <= 0) return MAX_REQ

  const prefix = key.slice(0, separator)
  return PREFIX_OVERRIDES.get(prefix) || MAX_REQ
}

function prune(now: number): number {
  let removed = 0
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) {
      buckets.delete(key)
      removed++
    }
  }

  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest === undefined) break
    buckets.delete(oldest)
    removed++
  }
  if (removed > 0) inc('gateway_ratelimit_pruned', removed)
  return removed
}

export function check(key: string): boolean {
  const now = Date.now()
  prune(now)
  const max = effectiveMaxForKey(key)
  gauge('gateway_ratelimit_effective_max_last', max)

  const b = buckets.get(key) || { count: 0, reset: now + WINDOW_MS }
  if (now >= b.reset) {
    b.count = 0
    b.reset = now + WINDOW_MS
  }
  b.count++
  buckets.set(key, b)
  prune(now)
  gauge('gateway_ratelimit_buckets', buckets.size)
  if (b.count > max) {
    inc('gateway_ratelimit_blocked')
    return false
  }
  return true
}

export function _reset() {
  buckets.clear()
  gauge('gateway_ratelimit_buckets', 0)
}
