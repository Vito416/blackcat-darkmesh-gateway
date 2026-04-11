import crypto from 'crypto'
import { safeCompareHexOrAscii } from '../crypto/safeCompare.js'
import { WebhookIdempotencyBoundary, type WebhookIdempotencyPolicy } from './webhookIdempotency.js'

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function fingerprintBody(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex')
}

const gopayWebhookIdempotency = new WebhookIdempotencyBoundary({
  ttlMs: positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_TTL_MS, 600000),
  maxKeys: positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_MAX_KEYS, 10000),
  keyMaxBytes: positiveInt(process.env.GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES, 512),
})

export type GoPayWebhookIdempotencyDecision = ReturnType<typeof gopayWebhookIdempotency.classify>

export function verifyGoPayWebhook(body: string, signatureHeader: string | null, secret: string): boolean {
  if (!body || !signatureHeader || !secret) return false

  const signature = signatureHeader.trim()
  if (!signature) return false

  const normalized = signature.startsWith('sha256=') ? signature.slice('sha256='.length).trim() : signature
  if (!normalized) return false

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return safeCompareHexOrAscii(expected, normalized)
}

export function classifyGoPayWebhookIdempotency(
  eventId: string | null | undefined,
  body: string,
  policy: WebhookIdempotencyPolicy = 'dedupe',
): GoPayWebhookIdempotencyDecision {
  return gopayWebhookIdempotency.classify(eventId, fingerprintBody(body), policy)
}
