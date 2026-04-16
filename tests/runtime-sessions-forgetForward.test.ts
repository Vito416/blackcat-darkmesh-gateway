import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reset, snapshot } from '../src/metrics.js'
import { forwardForgetEvent } from '../src/runtime/sessions/forgetForward.js'

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

describe('runtime sessions forget forward', () => {
  beforeEach(() => {
    reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('forwards a forget event with the configured bearer token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))

    const result = await forwardForgetEvent(
      { subject: 'site-a', key: 'cache-a', removed: 2, ts: '2026-04-12T10:00:00.000Z' },
      { url: 'https://worker.example/cache/forget', token: 'forward-secret', timeoutMs: 5000 },
      fetchSpy as unknown as typeof globalThis.fetch,
    )

    expect(result).toEqual({ forwarded: true, attempted: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe('https://worker.example/cache/forget')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer forward-secret',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      subject: 'site-a',
      key: 'cache-a',
      removed: 2,
      ts: '2026-04-12T10:00:00.000Z',
    })

    expect(snapshot().counters.gateway_cache_forget_forward_attempt).toBe(1)
    expect(snapshot().counters.gateway_cache_forget_forward_success).toBe(1)
  })

  it('times out forget forwarding without failing the local path', async () => {
    vi.useFakeTimers()

    const fetchSpy = vi.fn().mockImplementation((_, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          if (signal.aborted) {
            reject(abortError())
            return
          }
          signal.addEventListener(
            'abort',
            () => {
              reject(abortError())
            },
            { once: true },
          )
        }
      }) as Promise<Response>
    })

    const promise = forwardForgetEvent(
      { subject: 'site-b', removed: 0, ts: '2026-04-12T10:00:01.000Z' },
      { url: 'https://worker.example/cache/forget', timeoutMs: 50 },
      fetchSpy as unknown as typeof globalThis.fetch,
    )

    await vi.advanceTimersByTimeAsync(60)
    await expect(promise).resolves.toEqual({ forwarded: false, attempted: true })
    expect(snapshot().counters.gateway_cache_forget_forward_attempt).toBe(1)
    expect(snapshot().counters.gateway_cache_forget_forward_timeout).toBe(1)
  })

  it('treats non-configured forwarding as a skipped no-op', async () => {
    const fetchSpy = vi.fn()

    const result = await forwardForgetEvent(
      { key: 'cache-c', removed: 1, ts: '2026-04-12T10:00:02.000Z' },
      { timeoutMs: 3000 },
      fetchSpy as unknown as typeof globalThis.fetch,
    )

    expect(result).toEqual({ forwarded: false, attempted: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(snapshot().counters.gateway_cache_forget_forward_skipped).toBe(1)
  })

  it('keeps the local forget path fail-open when the forward endpoint rejects', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await forwardForgetEvent(
      { subject: 'site-d', removed: 1, ts: '2026-04-12T10:00:03.000Z' },
      { url: 'https://worker.example/cache/forget', timeoutMs: 3000 },
      fetchSpy as unknown as typeof globalThis.fetch,
    )

    expect(result).toEqual({ forwarded: false, attempted: true })
    expect(snapshot().counters.gateway_cache_forget_forward_attempt).toBe(1)
    expect(snapshot().counters.gateway_cache_forget_forward_failed).toBe(1)
  })
})
