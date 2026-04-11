import type { MailRetrySchedule, MailQueue, MailQueueItem } from './queue.js'
import { dequeueMail, enqueueMail, getMailRetrySchedule } from './queue.js'
import type { MailTransport, MailTransportResult } from './transport.js'

export type MailDeliveryAction =
  | {
      ok: true
      action: 'delivered'
      item: MailQueueItem
      result: MailTransportResult
      queueSizeBefore: number
      queueSizeAfter: number
    }
  | {
      ok: true
      action: 'requeued'
      item: MailQueueItem
      requeuedItem: MailQueueItem
      result: MailTransportResult
      retrySchedule: MailRetrySchedule
      queueSizeBefore: number
      queueSizeAfter: number
    }
  | {
      ok: false
      action: 'dropped'
      reason: 'empty-queue' | 'fail-permanent'
      item?: MailQueueItem
      result?: MailTransportResult
      queueSizeBefore: number
      queueSizeAfter: number
    }

export type MailDeliveryOptions = {
  retryBackoffMs?: number
  maxRetryBackoffMs?: number
  scheduledAt?: string
}

function cloneMailItem(item: MailQueueItem): MailQueueItem {
  return {
    ...item,
    to: [...item.to],
  }
}

export async function deliverNextMail(
  queue: MailQueue,
  transport: MailTransport,
  options: MailDeliveryOptions = {},
): Promise<MailDeliveryAction> {
  const queueSizeBefore = queue.items.length
  const item = dequeueMail(queue)

  if (!item) {
    return {
      ok: false,
      action: 'dropped',
      reason: 'empty-queue',
      queueSizeBefore,
      queueSizeAfter: queue.items.length,
    }
  }

  const result = await transport.send(cloneMailItem(item))

  if (result.outcome === 'success') {
    return {
      ok: true,
      action: 'delivered',
      item,
      result,
      queueSizeBefore,
      queueSizeAfter: queue.items.length,
    }
  }

  if (result.outcome === 'retry') {
    const attempt = Math.max(1, Math.floor((item.attempts ?? 0) + 1))
    const retrySchedule = getMailRetrySchedule(
      options.retryBackoffMs,
      attempt,
      options.scheduledAt ?? item.nextAttemptAt ?? item.queuedAt,
      options.maxRetryBackoffMs,
    )

    const requeuedItem = enqueueMail(
      queue,
      {
        ...item,
        attempts: attempt,
        nextAttemptAt: retrySchedule.nextAttemptAt,
      },
      retrySchedule.nextAttemptAt,
    )

    return {
      ok: true,
      action: 'requeued',
      item,
      requeuedItem,
      result,
      retrySchedule,
      queueSizeBefore,
      queueSizeAfter: queue.items.length,
    }
  }

  return {
    ok: false,
    action: 'dropped',
    reason: 'fail-permanent',
    item,
    result,
    queueSizeBefore,
    queueSizeAfter: queue.items.length,
  }
}
