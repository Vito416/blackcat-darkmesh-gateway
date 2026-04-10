import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

describe('budget metric instrumentation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
  })

  it('tracks cache budget gauges and reject reasons', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '2'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '4'
    process.env.GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT = '1'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const cache = await import('../src/cache.js')

    expect(cache.put('big', new TextEncoder().encode('abc').buffer)).toBe(false)
    expect(cache.put('k1', new Uint8Array([1]).buffer)).toBe(true)
    expect(cache.put('s1', new Uint8Array([3]).buffer, { subject: 'tenant-a' })).toBe(true)
    expect(cache.put('s2', new Uint8Array([4]).buffer, { subject: 'tenant-a' })).toBe(false)
    expect(cache.put('k2', new Uint8Array([2]).buffer)).toBe(true)
    expect(cache.put('k3', new Uint8Array([5]).buffer)).toBe(true)
    expect(cache.put('k4', new Uint8Array([6]).buffer)).toBe(false)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_cache_max_entry_bytes).toBe(2)
    expect(state.gauges.gateway_cache_max_entries).toBe(4)
    expect(state.gauges.gateway_cache_max_keys_per_subject).toBe(1)
    expect(state.gauges.gateway_cache_admission_mode).toBe(0)
    expect(state.counters.gateway_cache_store_reject).toBe(3)
    expect(state.counters.gateway_cache_store_reject_size).toBe(1)
    expect(state.counters.gateway_cache_store_reject_capacity).toBe(1)
    expect(state.counters.gateway_cache_store_reject_subject).toBe(1)
  })

  it('tracks lru admission mode gauge and eviction counter', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '8'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '1'
    process.env.GATEWAY_CACHE_ADMISSION_MODE = 'evict_lru'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const cache = await import('../src/cache.js')

    expect(cache.put('k1', new Uint8Array([1]).buffer)).toBe(true)
    expect(cache.put('k2', new Uint8Array([2]).buffer)).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_cache_admission_mode).toBe(1)
    expect(state.counters.gateway_cache_evict_lru).toBe(1)
    expect(state.counters.gateway_cache_store_reject_capacity || 0).toBe(0)
  })

  it('tracks ratelimit configured gauges and prune count', async () => {
    process.env.GATEWAY_RL_WINDOW_MS = '100000'
    process.env.GATEWAY_RL_MAX = '100'
    process.env.GATEWAY_RL_MAX_BUCKETS = '2'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const rate = await import('../src/ratelimit.js')

    expect(rate.check('k1')).toBe(true)
    expect(rate.check('k2')).toBe(true)
    expect(rate.check('k3')).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_ratelimit_max).toBe(100)
    expect(state.gauges.gateway_ratelimit_max_buckets).toBe(2)
    expect(state.counters.gateway_ratelimit_pruned).toBeGreaterThanOrEqual(1)
  })

  it('tracks replay configured gauges and prune count', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS = '600000'
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '2'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const replay = await import('../src/replay.js')

    expect(replay.markAndCheck('a')).toBe(false)
    expect(replay.markAndCheck('b')).toBe(false)
    expect(replay.markAndCheck('c')).toBe(false)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_webhook_replay_ttl_ms).toBe(600000)
    expect(state.gauges.gateway_webhook_replay_max_keys).toBe(2)
    expect(state.counters.gateway_webhook_replay_pruned).toBeGreaterThanOrEqual(1)
  })
})
