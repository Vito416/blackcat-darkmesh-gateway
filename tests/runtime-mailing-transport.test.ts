import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailTransport } from '../src/runtime/mailing/transport.js'
import { createMailQueue, dequeueMail, enqueueMail, peekMailQueue } from '../src/runtime/mailing/queue.js'

describe('runtime mailing transport boundary', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns ok=true for successful mail transport responses', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }))
    const transport = createMailTransport({
      endpoint: 'https://mail.example/send',
      token: 'gateway-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    const result = await transport.send({
      to: ['alice@example.com'],
      subject: 'Subject',
      body: 'Body',
      requestId: 'req-1',
    })

    expect(result).toEqual({ ok: true, status: 202 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('https://mail.example/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        to: ['alice@example.com'],
        subject: 'Subject',
        body: 'Body',
        requestId: 'req-1',
      }),
      signal: expect.any(AbortSignal),
    })
  })

  it('returns ok=false with status for non-2xx responses', async () => {
    const fetchSpy = vi.fn(async () => new Response('upstream failed', { status: 503 }))
    const transport = createMailTransport({
      endpoint: 'https://mail.example/send',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(
      transport.send({
        to: ['alice@example.com'],
        subject: 'Subject',
        body: 'Body',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'mail transport failed with status 503',
    })
  })

  it('returns timeout status when request aborts on timeout', async () => {
    vi.useFakeTimers()

    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true },
        )
      })
    })
    const transport = createMailTransport({
      endpoint: 'https://mail.example/send',
      timeoutMs: 15,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    const pending = transport.send({
      to: ['alice@example.com'],
      subject: 'Subject',
      body: 'Body',
      requestId: 'req-timeout',
    })
    await vi.advanceTimersByTimeAsync(15)

    await expect(pending).resolves.toEqual({
      ok: false,
      status: 408,
      error: 'mail transport request timed out',
    })
  })

  it('returns status=0 for network failures', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const transport = createMailTransport({
      endpoint: 'https://mail.example/send',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(
      transport.send({
        to: ['alice@example.com'],
        subject: 'Subject',
        body: 'Body',
        requestId: 'req-network',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 0,
      error: 'ECONNRESET',
    })
  })
})

describe('runtime mailing queue boundary', () => {
  it('dequeues items in deterministic FIFO order', () => {
    const queue = createMailQueue(3)
    enqueueMail(queue, { to: ['a@example.com'], subject: 'one', body: 'body', requestId: 'req-1' }, '2026-04-11T00:00:01.000Z')
    enqueueMail(queue, { to: ['b@example.com'], subject: 'two', body: 'body', requestId: 'req-2' }, '2026-04-11T00:00:02.000Z')
    enqueueMail(queue, { to: ['c@example.com'], subject: 'three', body: 'body', requestId: 'req-3' }, '2026-04-11T00:00:03.000Z')

    expect(dequeueMail(queue)?.requestId).toBe('req-1')
    expect(dequeueMail(queue)?.requestId).toBe('req-2')
    expect(dequeueMail(queue)?.requestId).toBe('req-3')
    expect(dequeueMail(queue)).toBeUndefined()
  })

  it('drops oldest items when capacity is exceeded', () => {
    const queue = createMailQueue(2)
    enqueueMail(queue, { to: ['a@example.com'], subject: 'one', body: 'body', requestId: 'req-1' }, '2026-04-11T00:00:01.000Z')
    enqueueMail(queue, { to: ['b@example.com'], subject: 'two', body: 'body', requestId: 'req-2' }, '2026-04-11T00:00:02.000Z')
    enqueueMail(queue, { to: ['c@example.com'], subject: 'three', body: 'body', requestId: 'req-3' }, '2026-04-11T00:00:03.000Z')

    expect(peekMailQueue(queue).map((item) => item.requestId)).toEqual(['req-2', 'req-3'])
    expect(dequeueMail(queue)?.requestId).toBe('req-2')
    expect(dequeueMail(queue)?.requestId).toBe('req-3')
  })
})
