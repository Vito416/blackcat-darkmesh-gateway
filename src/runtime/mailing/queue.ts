import type { MailTransportRequest } from './transport.js'

export type MailQueueItem = MailTransportRequest & {
  queuedAt: string
}

export type MailQueue = {
  maxItems: number
  items: MailQueueItem[]
}

function normalizeQueueCap(maxItems: number): number {
  if (!Number.isFinite(maxItems) || maxItems < 1) return 1
  return Math.floor(maxItems)
}

function cloneQueueItem(item: MailQueueItem): MailQueueItem {
  return {
    ...item,
    to: [...item.to],
  }
}

export function createMailQueue(maxItems: number): MailQueue {
  return {
    maxItems: normalizeQueueCap(maxItems),
    items: [],
  }
}

export function enqueueMail(
  queue: MailQueue,
  request: MailTransportRequest,
  queuedAt = new Date().toISOString(),
): MailQueueItem {
  const item: MailQueueItem = {
    ...request,
    to: [...request.to],
    queuedAt,
  }

  queue.items.push(item)
  while (queue.items.length > queue.maxItems) {
    queue.items.shift()
  }

  return item
}

export function dequeueMail(queue: MailQueue): MailQueueItem | undefined {
  const item = queue.items.shift()
  return item ? cloneQueueItem(item) : undefined
}

export function peekMailQueue(queue: MailQueue): MailQueueItem[] {
  return queue.items.map(cloneQueueItem)
}
