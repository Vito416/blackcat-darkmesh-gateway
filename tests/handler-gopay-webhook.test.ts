import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

function gopaySignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function loadHandler() {
  vi.resetModules()
  return import('../src/handler.js')
}

describe.sequential('handler gopay webhook route', () => {
  const originalEnv = { ...process.env }
  const webhookSecret = 'gopay_test_secret'

  beforeEach(async () => {
    vi.resetModules()
    const { reset } = await import('../src/metrics.js')
    reset()
    process.env.AO_INTEGRITY_URL = ''
    process.env.AO_INTEGRITY_MIRROR_URLS = ''
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('returns 200 when gopay signature is valid', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ id: 'event-ok', amount: 1000 })
    const headers = new Headers({
      'x-gopay-signature': gopaySignature(body, webhookSecret),
      'x-gopay-event-id': 'gopay-event-000',
    })

    const res = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('ok')
  })

  it('returns 401 when gopay signature is invalid', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ id: 'event-bad' })
    const headers = new Headers({
      'x-gopay-signature': 'bad-signature',
    })

    const res = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(res.status).toBe(401)
  })

  it('dedupes a repeated GoPay event id', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ id: 'event-replay', status: 'PAID' })
    const headers = new Headers({
      'x-gopay-signature': gopaySignature(body, webhookSecret),
      'x-gopay-event-id': 'gopay-event-001',
    })

    const first = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(first.status).toBe(200)
    await expect(first.text()).resolves.toBe('ok')

    const second = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(second.status).toBe(200)
    await expect(second.text()).resolves.toBe('replay')
  })

  it('rejects a repeated GoPay event id when reject policy is configured', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    process.env.GOPAY_WEBHOOK_IDEMPOTENCY_POLICY = 'reject'
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ id: 'event-reject', status: 'PAID' })
    const headers = new Headers({
      'x-gopay-signature': gopaySignature(body, webhookSecret),
      'x-gopay-event-id': 'gopay-event-002',
    })

    const first = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(first.status).toBe(200)
    await expect(first.text()).resolves.toBe('ok')

    const second = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(second.status).toBe(409)
    await expect(second.text()).resolves.toBe('duplicate event id')
  })

  it('rejects a GoPay webhook without an event id', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ amount: 1000, status: 'PAID' })
    const headers = new Headers({
      'x-gopay-signature': gopaySignature(body, webhookSecret),
    })

    const res = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(res.status).toBe(400)
    await expect(res.text()).resolves.toBe('missing event id')
  })

  it('rejects a conflicting GoPay payload for the same event id', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    const { handleRequest } = await loadHandler()
    const eventId = 'gopay-event-002'
    const firstBody = JSON.stringify({ id: 'event-1', status: 'PAID' })
    const secondBody = JSON.stringify({ id: 'event-1', status: 'FAILED' })
    const headers = new Headers({
      'x-gopay-event-id': eventId,
      'x-gopay-signature': gopaySignature(firstBody, webhookSecret),
    })
    const first = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body: firstBody, headers }))
    expect(first.status).toBe(200)
    await expect(first.text()).resolves.toBe('ok')

    const conflictHeaders = new Headers({
      'x-gopay-event-id': eventId,
      'x-gopay-signature': gopaySignature(secondBody, webhookSecret),
    })
    const second = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body: secondBody, headers: conflictHeaders }))
    expect(second.status).toBe(409)
    await expect(second.text()).resolves.toBe('conflicting event payload for event id')
  })

  it('returns 413 for oversized gopay payloads', async () => {
    process.env.GOPAY_WEBHOOK_SECRET = webhookSecret
    process.env.GATEWAY_WEBHOOK_MAX_BODY_BYTES = '64'
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({
      id: 'event-big',
      note: 'x'.repeat(256),
    })
    const headers = new Headers({
      'x-gopay-signature': gopaySignature(body, webhookSecret),
    })

    const res = await handleRequest(new Request('http://gateway/webhook/gopay', { method: 'POST', body, headers }))
    expect(res.status).toBe(413)
    await expect(res.text()).resolves.toBe('payload too large')
  })

  it('falls back to the default key-size limit when replay config is invalid', async () => {
    process.env.GATEWAY_WEBHOOK_REPLAY_KEY_MAX_BYTES = 'not-a-number'
    const { classifyGoPayWebhookIdempotency } = await import('../src/runtime/payments/gopayWebhook.js')

    const decision = classifyGoPayWebhookIdempotency('x'.repeat(513), '{}')
    expect(decision.status).toBe('missing-id')
    expect(decision.httpStatus).toBe(400)
  })
})
