import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const envKeys = [
  'GATEWAY_RL_MAX',
  'GATEWAY_RL_WINDOW_MS',
  'GATEWAY_RL_MAX_BUCKETS',
  'GATEWAY_WEBHOOK_REPLAY_TTL_MS',
  'GATEWAY_WEBHOOK_REPLAY_MAX_KEYS',
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

    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('r1')).toBe(false)
    expect(markAndCheck('r2')).toBe(false)
    expect(markAndCheck('r3')).toBe(false)
    expect(markAndCheck('r1')).toBe(false)
    expect(markAndCheck('r3')).toBe(true)
  })

  it('expires replay entries on the exact TTL boundary', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS = '100'
    process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS = '10'
    vi.resetModules()

    const { markAndCheck } = await import('../src/replay.js')

    expect(markAndCheck('ttl-boundary')).toBe(false)
    vi.setSystemTime(100)
    expect(markAndCheck('ttl-boundary')).toBe(false)
  })
})
