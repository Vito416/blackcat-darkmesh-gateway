export type WebhookIdempotencyPolicy = 'dedupe' | 'reject'
export type WebhookIdempotencyStatus = 'accepted' | 'missing-id' | 'duplicate' | 'conflict'

export type WebhookIdempotencyDecision = {
  status: WebhookIdempotencyStatus
  httpStatus: number
  body: string
}

type WebhookIdempotencyEntry = {
  fingerprint: string
  seenAt: number
}

export type WebhookIdempotencyBoundaryOptions = {
  ttlMs: number
  maxKeys: number
  keyMaxBytes: number
  now?: () => number
}

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export class WebhookIdempotencyBoundary {
  private readonly ttlMs: number
  private readonly maxKeys: number
  private readonly keyMaxBytes: number
  private readonly now: () => number
  private readonly entries = new Map<string, WebhookIdempotencyEntry>()

  constructor(options: WebhookIdempotencyBoundaryOptions) {
    this.ttlMs = positiveInt(options.ttlMs, 600000)
    this.maxKeys = positiveInt(options.maxKeys, 10000)
    this.keyMaxBytes = positiveInt(options.keyMaxBytes, 512)
    this.now = options.now || Date.now
  }

  classify(
    eventId: string | null | undefined,
    fingerprint: string,
    policy: WebhookIdempotencyPolicy = 'dedupe',
  ): WebhookIdempotencyDecision {
    const normalizedEventId = typeof eventId === 'string' ? eventId.trim() : ''
    if (!normalizedEventId) {
      return { status: 'missing-id', httpStatus: 400, body: 'missing event id' }
    }

    if (Buffer.byteLength(normalizedEventId, 'utf8') > this.keyMaxBytes) {
      return { status: 'missing-id', httpStatus: 400, body: 'missing event id' }
    }

    this.pruneExpired(this.now())

    const prior = this.entries.get(normalizedEventId)
    if (prior) {
      if (prior.fingerprint === fingerprint) {
        return policy === 'reject'
          ? { status: 'duplicate', httpStatus: 409, body: 'duplicate event id' }
          : { status: 'duplicate', httpStatus: 200, body: 'replay' }
      }
      return { status: 'conflict', httpStatus: 409, body: 'conflicting event payload for event id' }
    }

    if (this.entries.size >= this.maxKeys) {
      this.pruneOldest()
    }

    this.entries.set(normalizedEventId, { fingerprint, seenAt: this.now() })
    return { status: 'accepted', httpStatus: 200, body: 'ok' }
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.seenAt > this.ttlMs) {
        this.entries.delete(key)
      }
    }
  }

  private pruneOldest() {
    let oldestKey: string | undefined
    let oldestSeenAt = Number.POSITIVE_INFINITY
    for (const [key, entry] of this.entries) {
      if (entry.seenAt < oldestSeenAt) {
        oldestSeenAt = entry.seenAt
        oldestKey = key
      }
    }
    if (oldestKey) this.entries.delete(oldestKey)
  }
}
