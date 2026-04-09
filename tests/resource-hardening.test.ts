import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('resource hardening edge cases', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  it('cleans up a large cache subject after expiry without leaving dangling entries', async () => {
    process.env.GATEWAY_CACHE_TTL_MS = '1'
    const cache = await import('../src/cache.js')
    const value = new TextEncoder().encode('template-payload').buffer

    for (let i = 0; i < 256; i++) {
      cache.put(`cache-${i}`, value.slice(0), 'subject-a')
    }

    vi.advanceTimersByTime(2)
    cache.sweep()

    expect(cache.get('cache-0')).toBeNull()
    expect(cache.get('cache-255')).toBeNull()
    expect(cache.forgetSubject('subject-a')).toBe(0)
    expect(cache.dropKey('cache-0')).toBe(false)
  })

  it('reclaims expired cache capacity before admitting a fresh entry in diskless mode', async () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'diskless'
    process.env.GATEWAY_CACHE_TTL_MS = '1'
    process.env.GATEWAY_CACHE_MAX_ENTRIES = '2'
    const cache = await import('../src/cache.js')
    const value = new TextEncoder().encode('template-payload').buffer

    expect(cache.put('cache-a', value.slice(0), 'subject-a')).toBe(true)
    expect(cache.put('cache-b', value.slice(0), 'subject-a')).toBe(true)
    vi.advanceTimersByTime(2)

    expect(cache.put('cache-c', value.slice(0), 'subject-b')).toBe(true)
    expect(cache.get('cache-a')).toBeNull()
    expect(cache.get('cache-b')).toBeNull()
    expect(cache.get('cache-c')).not.toBeNull()
    expect(cache.forgetSubject('subject-a')).toBe(0)
  })

  it('keeps the rate-limit bucket blocked on the reset boundary and releases it after the boundary', async () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'wedos_small'
    process.env.GATEWAY_RL_WINDOW_MS = '1000'
    process.env.GATEWAY_RL_MAX = '1'
    const rateLimit = await import('../src/ratelimit.js')
    rateLimit._reset()

    expect(rateLimit.check('ip:1')).toBe(true)
    expect(rateLimit.check('ip:1')).toBe(false)

    vi.advanceTimersByTime(999)
    expect(rateLimit.check('ip:1')).toBe(false)

    vi.advanceTimersByTime(1)
    expect(rateLimit.check('ip:1')).toBe(true)
  })

  it('rejects template calls before any upstream fetch when the action is unsupported or misconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const { proxyTemplateCall } = await import('../src/templateApi.js')

    const unsupported = await proxyTemplateCall({ action: 'evil.exec', payload: {} })
    expect(unsupported.status).toBe(403)

    const misconfigured = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/' },
    })
    expect(misconfigured.status).toBe(503)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
