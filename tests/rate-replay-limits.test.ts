import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const envKeys = [
  'GATEWAY_RL_MAX',
  'GATEWAY_RL_WINDOW_MS',
  'GATEWAY_RL_MAX_BUCKETS',
  'GATEWAY_WEBHOOK_REPLAY_TTL_MS',
  'GATEWAY_WEBHOOK_REPLAY_MAX_KEYS',
  'GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS',
  'GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES',
  'GATEWAY_RESOURCE_PROFILE',
]

function clearEnv() {
  for (const key of envKeys) delete process.env[key]
}

describe.sequential('bounded rate-limit and replay limits', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    clearEnv()
    vi.resetModules()
    vi.useRealTimers()
  })

  it('evicts the oldest rate-limit bucket when the map cap is exceeded', async () => {
    process.env.GATEWAY_RL_MAX = '1'
    process.env.GATEWAY_RL_WINDOW_MS = '1000'
    process.env.GATEWAY_RL_MAX_BUCKETS = '2'
    vi.resetModules()

    const rl = await import('../src/ratelimit.js')
    rl._reset()

    expect(rl.check('a')).toBe(true)
    expect(rl.check('b')).toBe(true)
    expect(rl.check('c')).toBe(true)
    expect(rl.check('a')).toBe(true)
  })

  it('resets rate-limit counts on the exact window boundary', async () => {
    process.env.GATEWAY_RL_MAX = '1'
    process.env.GATEWAY_RL_WINDOW_MS = '100'
    process.env.GATEWAY_RL_MAX_BUCKETS = '2'
    vi.resetModules()

    const rl = await import('../src/ratelimit.js')
    rl._reset()

    expect(rl.check('ip')).toBe(true)
    expect(rl.check('ip')).toBe(false)
    vi.setSystemTime(100)
    expect(rl.check('ip')).toBe(true)
  })

  it('evicts the oldest replay entry when the map cap is exceeded', async () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'diskless'
    process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS = '1000'
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '2'
    vi.resetModules()

    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('r1')).toBe(false)
    expect(markAndCheck('r2')).toBe(false)
    expect(markAndCheck('r3')).toBe(false)
    expect(markAndCheck('r1')).toBe(false)
    expect(markAndCheck('r3')).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_webhook_replay_size).toBe(2)
    expect(state.counters.gateway_webhook_replay_pruned).toBeGreaterThanOrEqual(1)
  })

  it('expires replay entries on the exact TTL boundary', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS = '100'
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '10'
    vi.resetModules()

    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('ttl-boundary')).toBe(false)
    vi.setSystemTime(100)
    expect(markAndCheck('ttl-boundary')).toBe(false)
  })

  it('does not sweep on every call before the interval elapses', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS = '100'
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '10'
    process.env.GATEWAY_WEBHOOK_REPLAY_SWEEP_INTERVAL_MS = '1000'
    vi.resetModules()

    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('a')).toBe(false)
    vi.setSystemTime(200)
    expect(markAndCheck('b')).toBe(false)

    let state = metrics.snapshot()
    expect(state.gauges.gateway_webhook_replay_size).toBe(2)
    expect(state.counters.gateway_webhook_replay_pruned || 0).toBe(0)

    vi.setSystemTime(1000)
    expect(markAndCheck('c')).toBe(false)

    state = metrics.snapshot()
    expect(state.gauges.gateway_webhook_replay_size).toBe(1)
    expect(state.counters.gateway_webhook_replay_pruned).toBe(2)
  })

  it('rejects overlong keys as replay without growing the map', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '10'
    process.env.GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES = '4'
    vi.resetModules()

    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('toolong')).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_webhook_replay_size).toBe(0)
    expect(state.counters.gateway_webhook_replay_key_reject).toBe(1)
    expect(state.counters.gateway_webhook_replay).toBe(1)
  })

  it('keeps replay detection intact for normal keys', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS = '1000'
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '10'
    vi.resetModules()

    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('same-key')).toBe(false)
    expect(markAndCheck('same-key')).toBe(true)

    const state = metrics.snapshot()
    expect(state.gauges.gateway_webhook_replay_size).toBe(1)
    expect(state.counters.gateway_webhook_replay).toBe(1)
  })
})
