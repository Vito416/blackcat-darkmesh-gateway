import { describe, expect, it, vi } from 'vitest'
import { deliverNextMail } from '../src/runtime/mailing/delivery.js'
import { createMailQueue, enqueueMail } from '../src/runtime/mailing/queue.js'

describe('runtime mailing delivery boundary', () => {
  it('delivers the dequeued item when transport succeeds', async () => {
    const queue = createMailQueue(4)
    const request = {
      to: ['alice@example.com'],
      subject: 'Welcome',
      body: 'Hello there',
      requestId: 'req-delivered',
    }
    enqueueMail(queue, request, '2026-04-11T00:00:00.000Z')

    const send = vi.fn(async () => ({ ok: true, status: 202, outcome: 'success' as const }))

    const action = await deliverNextMail(queue, { send })

    expect(action).toEqual({
      ok: true,
      action: 'delivered',
      item: {
        ...request,
        queuedAt: '2026-04-11T00:00:00.000Z',
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
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      ...request,
      queuedAt: '2026-04-11T00:00:00.000Z',
    })
  })

  it('requeues retryable transport failures with a computed backoff schedule', async () => {
    const queue = createMailQueue(4)
    const request = {
      to: ['bob@example.com'],
      subject: 'Retry me',
      body: 'Please try again',
      requestId: 'req-retry',
    }
    enqueueMail(queue, request, '2026-04-11T00:00:00.000Z')

    const send = vi.fn(async () => ({
      ok: false,
      status: 503,
      outcome: 'retry' as const,
      error: 'mail transport failed with status 503',
    }))

    const action = await deliverNextMail(queue, { send }, {
      retryBackoffMs: 250,
      scheduledAt: '2026-04-11T00:00:00.000Z',
    })

    expect(action).toEqual({
      ok: true,
      action: 'requeued',
      item: {
        ...request,
        queuedAt: '2026-04-11T00:00:00.000Z',
      },
      requeuedItem: {
        ...request,
        queuedAt: '2026-04-11T00:00:00.250Z',
        attempts: 1,
        nextAttemptAt: '2026-04-11T00:00:00.250Z',
      },
      result: {
        ok: false,
        status: 503,
        outcome: 'retry',
        error: 'mail transport failed with status 503',
      },
      retrySchedule: {
        attempt: 1,
        delayMs: 250,
        nextAttemptAt: '2026-04-11T00:00:00.250Z',
      },
      queueSizeBefore: 1,
      queueSizeAfter: 1,
    })
    expect(queue.items).toEqual([
      {
        ...request,
        queuedAt: '2026-04-11T00:00:00.250Z',
        attempts: 1,
        nextAttemptAt: '2026-04-11T00:00:00.250Z',
      },
    ])
  })

  it('drops permanent transport failures after dequeueing the item', async () => {
    const queue = createMailQueue(4)
    const request = {
      to: ['carol@example.com'],
      subject: 'No retry',
      body: 'This should stop',
      requestId: 'req-drop',
    }
    enqueueMail(queue, request, '2026-04-11T00:00:00.000Z')

    const send = vi.fn(async () => ({
      ok: false,
      status: 400,
      outcome: 'fail-permanent' as const,
      error: 'mail transport failed with status 400',
    }))

    const action = await deliverNextMail(queue, { send })

    expect(action).toEqual({
      ok: false,
      action: 'dropped',
      reason: 'fail-permanent',
      item: {
        ...request,
        queuedAt: '2026-04-11T00:00:00.000Z',
      },
      result: {
        ok: false,
        status: 400,
        outcome: 'fail-permanent',
        error: 'mail transport failed with status 400',
      },
      queueSizeBefore: 1,
      queueSizeAfter: 0,
    })
    expect(queue.items).toEqual([])
  })

  it('returns a deterministic empty-queue drop without calling transport', async () => {
    const queue = createMailQueue(2)
    const send = vi.fn(async () => ({ ok: true, status: 202, outcome: 'success' as const }))

    const action = await deliverNextMail(queue, { send })

    expect(action).toEqual({
      ok: false,
      action: 'dropped',
      reason: 'empty-queue',
      queueSizeBefore: 0,
      queueSizeAfter: 0,
    })
    expect(send).not.toHaveBeenCalled()
  })
})
