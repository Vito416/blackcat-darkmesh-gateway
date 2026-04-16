import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAuthSdkClient } from '../src/clients/auth-sdk/client.js'

describe('auth sdk client boundary', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects unsafe base urls before creating a client', () => {
    const fetchSpy = vi.fn()

    expect(() =>
      createAuthSdkClient({
        baseUrl: 'javascript:alert(1)',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).toThrow('auth sdk client baseUrl must use http or https')

    expect(() =>
      createAuthSdkClient({
        baseUrl: 'https://user:pass@auth.example',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).toThrow('auth sdk client baseUrl must not include credentials')

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('enforces an optional host allowlist on the configured base url', () => {
    const fetchSpy = vi.fn()

    expect(() =>
      createAuthSdkClient({
        baseUrl: 'https://auth.example/api',
        hostAllowlist: ['api.example', 'allowed.example:443'],
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).toThrow('auth sdk client baseUrl host is not allowed: auth.example')

    const client = createAuthSdkClient({
      baseUrl: 'https://auth.example/api',
      hostAllowlist: ['auth.example'],
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    expect(client).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('joins urls strictly and forwards auth headers on success', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ active: true, sub: 'u-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    const client = createAuthSdkClient({
      baseUrl: 'https://auth.example/api//',
      token: 'gateway-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.health()).resolves.toEqual({ ok: true, status: 200 })
    await expect(client.introspectToken('token-123')).resolves.toEqual({
      ok: true,
      status: 200,
      body: { active: true, sub: 'u-1' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)

    const [healthUrl, healthInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(healthUrl)).toBe('https://auth.example/api/health')
    expect(healthInit.method).toBe('GET')
    expect(new Headers(healthInit.headers).get('authorization')).toBe('Bearer gateway-token')

    const [introspectUrl, introspectInit] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(String(introspectUrl)).toBe('https://auth.example/api/introspect')
    expect(introspectInit.method).toBe('POST')
    expect(new Headers(introspectInit.headers).get('content-type')).toBe('application/json')
    expect(new Headers(introspectInit.headers).get('authorization')).toBe('Bearer gateway-token')
    expect(JSON.parse(String(introspectInit.body))).toEqual({ token: 'token-123' })
  })

  it('returns json bodies only when the response content type is json', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('plain upstream text', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      )

    const client = createAuthSdkClient({
      baseUrl: 'https://auth.example',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.introspectToken('token-123')).resolves.toEqual({
      ok: true,
      status: 200,
      body: { ok: true },
    })

    await expect(client.introspectToken('token-456')).resolves.toEqual({
      ok: true,
      status: 200,
      body: 'plain upstream text',
    })
  })

  it('returns a stable timeout error shape when fetch aborts', async () => {
    vi.useFakeTimers()

    const fetchSpy = vi.fn().mockImplementation((_, init) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        const onAbort = () => {
          const error = new Error('request aborted')
          ;(error as Error & { name: string }).name = 'AbortError'
          reject(error)
        }

        if (signal?.aborted) {
          onAbort()
          return
        }

        signal?.addEventListener('abort', onAbort, { once: true })
      })
    })

    const client = createAuthSdkClient({
      baseUrl: 'https://auth.example',
      timeoutMs: 25,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    const resultPromise = client.introspectToken('token-123')
    await vi.advanceTimersByTimeAsync(25)

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      status: 0,
      body: { error: 'timeout' },
    })
  })

  it('returns a stable network failure shape', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('socket hang up'))

    const client = createAuthSdkClient({
      baseUrl: 'https://auth.example',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.introspectToken('token-123')).resolves.toEqual({
      ok: false,
      status: 0,
      body: { error: 'network_failure' },
    })
  })

  it('enforces a non-empty token for introspection', async () => {
    const fetchSpy = vi.fn()

    const client = createAuthSdkClient({
      baseUrl: 'https://auth.example',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.introspectToken('   ')).resolves.toEqual({
      ok: false,
      status: 0,
      body: { error: 'token_required' },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
