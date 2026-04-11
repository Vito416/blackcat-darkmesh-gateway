import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe.sequential('ReplayStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires entries through the sweep path after ttl elapses', async () => {
    const { ReplayStore } = await import('../src/runtime/sessions/replayStore.js')
    const store = new ReplayStore({
      ttlMs: 100,
      maxKeys: 10,
      sweepIntervalMs: 1000,
      keyMaxBytes: 64,
    })

    expect(store.markAndCheck('ttl')).toMatchObject({
      replay: false,
      rejected: false,
      pruned: 0,
      size: 1,
    })

    vi.setSystemTime(100)
    expect(store.sweep()).toBe(1)
    expect(store.size).toBe(0)
    expect(store.markAndCheck('ttl')).toMatchObject({
      replay: false,
      rejected: false,
      pruned: 0,
      size: 1,
    })
  })

  it('prunes the oldest entry when the cap is exceeded', async () => {
    const { ReplayStore } = await import('../src/runtime/sessions/replayStore.js')
    const store = new ReplayStore({
      ttlMs: 1000,
      maxKeys: 2,
      sweepIntervalMs: 1000,
      keyMaxBytes: 64,
    })

    expect(store.markAndCheck('a')).toMatchObject({ replay: false, pruned: 0, size: 1 })
    expect(store.markAndCheck('b')).toMatchObject({ replay: false, pruned: 0, size: 2 })
    expect(store.markAndCheck('c')).toMatchObject({ replay: false, pruned: 1, size: 2 })
    expect(store.markAndCheck('a')).toMatchObject({ replay: false, pruned: 1, size: 2 })
  })

  it('rejects oversized keys without storing them', async () => {
    const { ReplayStore } = await import('../src/runtime/sessions/replayStore.js')
    const store = new ReplayStore({
      ttlMs: 1000,
      maxKeys: 10,
      sweepIntervalMs: 1000,
      keyMaxBytes: 4,
    })

    expect(store.markAndCheck('toolong')).toMatchObject({
      replay: true,
      rejected: true,
      pruned: 0,
      size: 0,
    })
    expect(store.size).toBe(0)
  })
})
