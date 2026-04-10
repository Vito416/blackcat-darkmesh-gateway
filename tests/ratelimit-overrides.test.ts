import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadRateLimit() {
  return import('../src/ratelimit.js')
}

describe('rate-limit prefix overrides', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
  })

  it('applies a prefix override before the default max', async () => {
    process.env.GATEWAY_RL_MAX = '10'
    process.env.GATEWAY_RL_MAX_OVERRIDES = 'inbox=2,webhook=4'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const rate = await loadRateLimit()
    rate._reset()

    expect(rate.check('inbox:alpha')).toBe(true)
    expect(rate.check('inbox:alpha')).toBe(true)
    expect(rate.check('inbox:alpha')).toBe(false)
    expect(rate.check('webhook:event')).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_ratelimit_override_count).toBe(2)
    expect(state.gauges.gateway_ratelimit_effective_max_last).toBe(4)
  })

  it('falls back to the configured default max when no prefix override matches', async () => {
    process.env.GATEWAY_RL_MAX = '3'
    process.env.GATEWAY_RL_MAX_OVERRIDES = 'inbox=2,webhook=4'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const rate = await loadRateLimit()
    rate._reset()

    expect(rate.check('other:alpha')).toBe(true)
    expect(rate.check('other:alpha')).toBe(true)
    expect(rate.check('other:alpha')).toBe(true)
    expect(rate.check('other:alpha')).toBe(false)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_ratelimit_override_count).toBe(2)
    expect(state.gauges.gateway_ratelimit_effective_max_last).toBe(3)
  })

  it('ignores invalid override entries safely', async () => {
    process.env.GATEWAY_RL_MAX = '5'
    process.env.GATEWAY_RL_MAX_OVERRIDES = 'bad,foo=,bar=-1,ok=2, spaced = 4, z=abc'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const rate = await loadRateLimit()
    rate._reset()

    expect(rate.check('ok:alpha')).toBe(true)
    expect(rate.check('ok:alpha')).toBe(true)
    expect(rate.check('ok:alpha')).toBe(false)
    expect(rate.check('spaced:item')).toBe(true)
    expect(rate.check('other:item')).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_ratelimit_override_count).toBe(2)
    expect(state.gauges.gateway_ratelimit_effective_max_last).toBe(5)
  })

  it('keeps reset behavior unchanged with overrides enabled', async () => {
    process.env.GATEWAY_RL_MAX = '1'
    process.env.GATEWAY_RL_MAX_OVERRIDES = 'inbox=2'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const rate = await loadRateLimit()
    rate._reset()

    expect(rate.check('inbox:alpha')).toBe(true)
    expect(rate.check('inbox:alpha')).toBe(true)
    expect(rate.check('inbox:alpha')).toBe(false)

    rate._reset()

    expect(rate.check('inbox:alpha')).toBe(true)
    expect(rate.check('inbox:alpha')).toBe(true)
    expect(rate.check('inbox:alpha')).toBe(false)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_ratelimit_override_count).toBe(1)
    expect(state.gauges.gateway_ratelimit_buckets).toBe(1)
    expect(state.gauges.gateway_ratelimit_effective_max_last).toBe(2)
  })
})
