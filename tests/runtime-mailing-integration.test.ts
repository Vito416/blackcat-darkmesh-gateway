import { describe, expect, it, vi } from 'vitest'
import { deliverNextMail } from '../src/runtime/mailing/delivery.js'
import { createMailQueue, enqueueMail } from '../src/runtime/mailing/queue.js'
import { createMailTransport } from '../src/runtime/mailing/transport.js'

describe('runtime mailing end-to-end boundary', () => {
  it('moves a queued mail item through transport retry and eventual delivery deterministically', async () => {
    const queue = createMailQueue(4)
    const queuedAt = '2026-04-11T00:00:00.000Z'
    const request = {
      to: ['inbox@example.com'],
      subject: 'Queue flow',
      body: 'First attempt should retry, second should deliver',
      requestId: 'req-e2e',
    }

    enqueueMail(queue, request, queuedAt)

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body))

      if (fetchSpy.mock.calls.length === 1) {
        expect(payload).toEqual({
          ...request,
          queuedAt,
        })

        return new Response('temporary failure', { status: 503 })
      }

      expect(payload).toEqual({
        ...request,
        queuedAt: '2026-04-11T00:00:00.300Z',
        attempts: 1,
        nextAttemptAt: '2026-04-11T00:00:00.300Z',
      })

      return new Response(null, { status: 202 })
    })

    const transport = createMailTransport({
      endpoint: 'https://mail.example/send',
      token: 'gateway-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    const firstPass = await deliverNextMail(queue, transport, {
      retryBackoffMs: 300,
      scheduledAt: queuedAt,
    })

    expect(firstPass).toEqual({
      ok: true,
      action: 'requeued',
      item: {
        ...request,
        queuedAt,
      },
      requeuedItem: {
        ...request,
        queuedAt: '2026-04-11T00:00:00.300Z',
        attempts: 1,
        nextAttemptAt: '2026-04-11T00:00:00.300Z',
      },
      result: {
        ok: false,
        status: 503,
        outcome: 'retry',
        error: 'mail transport failed with status 503',
      },
      retrySchedule: {
        attempt: 1,
        delayMs: 300,
        nextAttemptAt: '2026-04-11T00:00:00.300Z',
      },
      queueSizeBefore: 1,
      queueSizeAfter: 1,
    })

    const secondPass = await deliverNextMail(queue, transport, {
      retryBackoffMs: 300,
      scheduledAt: queuedAt,
    })

    expect(secondPass).toEqual({
      ok: true,
      action: 'delivered',
      item: {
        ...request,
        queuedAt: '2026-04-11T00:00:00.300Z',
        attempts: 1,
        nextAttemptAt: '2026-04-11T00:00:00.300Z',
      },
      result: {
        ok: true,
        status: 202,
        outcome: 'success',
      },
      queueSizeBefore: 1,
      queueSizeAfter: 0,
    })

    expect(queue.items).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenNthCalledWith(1, 'https://mail.example/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        ...request,
        queuedAt,
      }),
      signal: expect.any(AbortSignal),
    })
    expect(fetchSpy).toHaveBeenNthCalledWith(2, 'https://mail.example/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        ...request,
        queuedAt: '2026-04-11T00:00:00.300Z',
        attempts: 1,
        nextAttemptAt: '2026-04-11T00:00:00.300Z',
      }),
      signal: expect.any(AbortSignal),
    })
  })
})
