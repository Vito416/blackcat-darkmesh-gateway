import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCryptoSdkClient } from '../src/clients/crypto-sdk/client.js'

describe('crypto sdk client boundary', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('posts verify requests with bearer auth and returns response body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ verified: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = createCryptoSdkClient({
      baseUrl: 'https://crypto.example//',
      token: 'top-secret',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.verifyEnvelope({ envelope: { id: 'env-1' }, context: 'checkout' })).resolves.toEqual({
      ok: true,
      status: 200,
      body: { verified: true },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [verifyUrl, verifyInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(verifyUrl)).toBe('https://crypto.example/api/crypto/verify-envelope')
    expect(verifyInit.method).toBe('POST')
    expect(new Headers(verifyInit.headers).get('authorization')).toBe('Bearer top-secret')
    expect(new Headers(verifyInit.headers).get('accept')).toBe('application/json')
    expect(new Headers(verifyInit.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(verifyInit.body))).toEqual({
      envelope: { id: 'env-1' },
      context: 'checkout',
    })
  })

  it('checks health using the same auth boundary', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    const client = createCryptoSdkClient({
      baseUrl: 'https://crypto.example/api//',
      token: 'top-secret',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.health()).resolves.toEqual({
      ok: true,
      status: 204,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [healthUrl, healthInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(healthUrl)).toBe('https://crypto.example/api/health')
    expect(healthInit.method).toBe('GET')
    expect(new Headers(healthInit.headers).get('authorization')).toBe('Bearer top-secret')
    expect(new Headers(healthInit.headers).get('accept')).toBe('application/json')
  })

  it('returns envelope_required when envelope is missing', async () => {
    const fetchSpy = vi.fn()
    const client = createCryptoSdkClient({
      baseUrl: 'https://crypto.example',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.verifyEnvelope({} as never)).resolves.toEqual({
      ok: false,
      status: 0,
      body: {
        error: 'envelope_required',
      },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns stable timeout error bodies when verify requests time out', async () => {
    vi.useFakeTimers()

    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        signal.addEventListener(
          'abort',
          () => {
            const abortError = new Error('aborted') as Error & { name: string }
            abortError.name = 'AbortError'
            reject(abortError)
          },
          { once: true },
        )
      })
    })

    const client = createCryptoSdkClient({
      baseUrl: 'https://crypto.example',
      timeoutMs: 25,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    const resultPromise = client.verifyEnvelope({ envelope: { id: 'env-timeout' } })
    await vi.advanceTimersByTimeAsync(30)

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      status: 0,
      body: {
        error: 'timeout',
      },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns stable network failure bodies when fetch rejects', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'))
    const client = createCryptoSdkClient({
      baseUrl: 'https://crypto.example',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(client.verifyEnvelope({ envelope: { id: 'env-offline' } })).resolves.toEqual({
      ok: false,
      status: 0,
      body: {
        error: 'network_failure',
      },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
