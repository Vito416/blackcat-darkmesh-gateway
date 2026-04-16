import type { MailTransportRequest } from './transport.js'

export type MailQueueItem = MailTransportRequest & {
  queuedAt: string
  attempts?: number
  nextAttemptAt?: string
}

export type MailRetrySchedule = {
  attempt: number
  delayMs: number
  nextAttemptAt: string
}

export type MailQueue = {
  maxItems: number
  items: MailQueueItem[]
}

const DEFAULT_RETRY_BACKOFF_MS = 100
const MAX_RETRY_BACKOFF_MS = 5_000

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

function addMilliseconds(isoTimestamp: string, delayMs: number): string {
  const timestamp = Date.parse(isoTimestamp)
  if (!Number.isFinite(timestamp)) return isoTimestamp

  return new Date(timestamp + delayMs).toISOString()
}

export function createMailQueue(maxItems: number): MailQueue {
  return {
    maxItems: normalizeQueueCap(maxItems),
    items: [],
  }
}

export function enqueueMail(
  queue: MailQueue,
  request: MailTransportRequest & Partial<Pick<MailQueueItem, 'attempts' | 'nextAttemptAt'>>,
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

export function getMailRetryDelayMs(
  retryBackoffMs: number = DEFAULT_RETRY_BACKOFF_MS,
  attempt: number,
  maxRetryBackoffMs: number = MAX_RETRY_BACKOFF_MS,
): number {
  if (!Number.isFinite(retryBackoffMs) || retryBackoffMs <= 0) return 0
  if (!Number.isFinite(attempt) || attempt < 1) return 0

  const cappedBackoffMs = Number.isFinite(maxRetryBackoffMs) && maxRetryBackoffMs > 0 ? Math.floor(maxRetryBackoffMs) : MAX_RETRY_BACKOFF_MS
  const delayMs = Math.floor(retryBackoffMs) * 2 ** (attempt - 1)

  return Math.min(delayMs, cappedBackoffMs)
}

export function getMailRetrySchedule(
  retryBackoffMs: number = DEFAULT_RETRY_BACKOFF_MS,
  attempt: number,
  scheduledAt: string = new Date().toISOString(),
  maxRetryBackoffMs: number = MAX_RETRY_BACKOFF_MS,
): MailRetrySchedule {
  const delayMs = getMailRetryDelayMs(retryBackoffMs, attempt, maxRetryBackoffMs)

  return {
    attempt,
    delayMs,
    nextAttemptAt: addMilliseconds(scheduledAt, delayMs),
  }
}
