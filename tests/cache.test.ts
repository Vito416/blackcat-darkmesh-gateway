import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const originalEnv = { ...process.env }

function bufferOf(size: number): ArrayBuffer {
  return new Uint8Array(size).buffer
}

function textOf(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

async function loadCache() {
  return import('../src/cache.js')
}

describe('cache TTL, budgets, and rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    process.env = { ...originalEnv }
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
  })

  it('evicts entries after TTL', async () => {
    process.env.GATEWAY_CACHE_TTL_MS = '100'
    const { put, get } = await loadCache()
    const key = 'k1'
    expect(put(key, bufferOf(2))).toBe(true)
    expect(get(key)).not.toBeNull()
    vi.advanceTimersByTime(150)
    expect(get(key)).toBeNull()
  })

  it('falls back deterministically when cache env values are invalid', async () => {
    process.env.GATEWAY_CACHE_TTL_MS = 'not-a-number'
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '1'
    process.env.GATEWAY_CACHE_ADMISSION_MODE = 'maybe'
    const { put, get } = await loadCache()

    expect(put('k1', bufferOf(2))).toBe(true)
    expect(put('k2', bufferOf(2))).toBe(false)
    expect(get('k1')).not.toBeNull()

    vi.advanceTimersByTime(299999)
    expect(get('k1')).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(get('k1')).toBeNull()
  })

  it('rejects payloads that exceed the entry size budget', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '4'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '8'
    const { put, get } = await loadCache()

    expect(put('too-big', bufferOf(5))).toBe(false)
    expect(get('too-big')).toBeNull()
  })

  it('rejects new entries once the cache count budget is exhausted', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '1'
    const { put, get } = await loadCache()

    expect(put('k1', bufferOf(2))).toBe(true)
    expect(put('k2', bufferOf(2))).toBe(false)
    expect(get('k1')).not.toBeNull()
    expect(get('k2')).toBeNull()
  })

  it('evicts the least recently used entry when evict_lru admission is enabled', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '2'
    process.env.GATEWAY_CACHE_ADMISSION_MODE = 'evict_lru'
    const { put, get } = await loadCache()

    expect(put('k1', bufferOf(2))).toBe(true)
    expect(put('k2', bufferOf(2))).toBe(true)
    expect(get('k1')).not.toBeNull()
    expect(put('k3', bufferOf(2))).toBe(true)
    expect(get('k1')).not.toBeNull()
    expect(get('k2')).toBeNull()
    expect(get('k3')).not.toBeNull()
  })

  it('keeps subject cleanup aligned with lru eviction', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '2'
    process.env.GATEWAY_CACHE_ADMISSION_MODE = 'evict_lru'
    const { put, get, forgetSubject } = await loadCache()

    expect(put('k1', bufferOf(2), { subject: 'subject-a' })).toBe(true)
    expect(put('k2', bufferOf(2), { subject: 'subject-b' })).toBe(true)
    expect(get('k1')).not.toBeNull()
    expect(put('k3', bufferOf(2), { subject: 'subject-c' })).toBe(true)
    expect(get('k2')).toBeNull()
    expect(forgetSubject('subject-a')).toBe(1)
    expect(get('k1')).toBeNull()
    expect(forgetSubject('subject-b')).toBe(0)
  })

  it('stores normal entries and still supports subject forget', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '4'
    const { put, get, forgetSubject } = await loadCache()

    expect(put('k1', bufferOf(3), { subject: 'subject-a' })).toBe(true)
    expect(get('k1')).not.toBeNull()
    expect(forgetSubject('subject-a')).toBe(1)
    expect(get('k1')).toBeNull()
  })

  it('rejects new keys once a subject reaches its key budget', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '8'
    process.env.GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT = '2'
    const { put, get } = await loadCache()

    expect(put('k1', bufferOf(1), { subject: 'tenant-a' })).toBe(true)
    expect(put('k2', bufferOf(1), { subject: 'tenant-a' })).toBe(true)
    expect(put('k3', bufferOf(1), { subject: 'tenant-a' })).toBe(false)
    expect(get('k3')).toBeNull()
  })

  it('allows refreshing an existing key under a capped subject', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '8'
    process.env.GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT = '2'
    const { put, get } = await loadCache()

    expect(put('k1', bufferOf(1), { subject: 'tenant-a' })).toBe(true)
    expect(put('k2', bufferOf(1), { subject: 'tenant-a' })).toBe(true)
    expect(put('k1', new TextEncoder().encode('updated').buffer, { subject: 'tenant-a' })).toBe(true)
    expect(get('k1')).not.toBeNull()
    expect(textOf(get('k1') as ArrayBuffer)).toBe('updated')
  })

  it('keeps non-subject entries unaffected by per-subject caps', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '32'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '8'
    process.env.GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT = '1'
    const { put, get } = await loadCache()

    expect(put('k1', bufferOf(1), { subject: 'tenant-a' })).toBe(true)
    expect(put('k2', bufferOf(1), { subject: 'tenant-a' })).toBe(false)
    expect(put('anon-1', bufferOf(1))).toBe(true)
    expect(put('anon-2', bufferOf(1))).toBe(true)
    expect(get('anon-1')).not.toBeNull()
    expect(get('anon-2')).not.toBeNull()
  })

  it('rate-limit blocks after max', async () => {
    process.env.GATEWAY_RL_MAX = '2'
    process.env.GATEWAY_RL_WINDOW_MS = '1000'
    const rl = await import('../src/ratelimit.js')
    rl._reset()
    expect(rl.check('ip')).toBe(true)
    expect(rl.check('ip')).toBe(true)
    expect(rl.check('ip')).toBe(false)
    vi.advanceTimersByTime(1100)
    expect(rl.check('ip')).toBe(true)
  })
})
