import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

function gopaySignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function loadHandler() {
  vi.resetModules()
  return import('../src/handler.js')
}

describe('handler gopay webhook route', () => {
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

  it('returns replay on second request with repeated x-gopay-event-id', async () => {
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
})
