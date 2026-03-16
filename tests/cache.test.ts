import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('cache TTL and rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('evicts entries after TTL', async () => {
    process.env.GATEWAY_CACHE_TTL_MS = '100'
    vi.resetModules()
    const { put, get } = await import('../src/cache')
    const key = 'k1'
    put(key, new TextEncoder().encode('v1').buffer)
    expect(get(key)).not.toBeNull()
    vi.advanceTimersByTime(150)
    expect(get(key)).toBeNull()
  })

  it('rate-limit blocks after max', async () => {
    process.env.GATEWAY_RL_MAX = '2'
    process.env.GATEWAY_RL_WINDOW_MS = '1000'
    vi.resetModules()
    const rl = await import('../src/ratelimit')
    rl._reset()
    expect(rl.check('ip')).toBe(true)
    expect(rl.check('ip')).toBe(true)
    expect(rl.check('ip')).toBe(false)
    vi.advanceTimersByTime(1100)
    expect(rl.check('ip')).toBe(true)
  })
})
