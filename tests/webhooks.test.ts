import { describe, it, expect, vi } from 'vitest'
import { verifyStripe, verifyPayPal, noteCert } from '../src/webhooks'

const stripeSecret = 'whsec_test'

function stripeSig(body: string, ts: number, secret: string) {
  const payload = `${ts}.${body}`
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `t=${ts},v1=${hmac}`
}

import crypto from 'crypto'
import { markAndCheck } from '../src/replay'

describe('webhook verification', () => {
  it('verifies stripe signature', () => {
    const body = JSON.stringify({ id: 'evt_1', object: 'event' })
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(body, ts, stripeSecret)
    const ok = verifyStripe(body, sig, stripeSecret, 300000)
    expect(ok).toBe(true)
  })

  it('rejects bad stripe signature', () => {
    const body = '{}'
    const ts = Math.floor(Date.now() / 1000)
    const ok = verifyStripe(body, `t=${ts},v1=badsig`, stripeSecret, 300000)
    expect(ok).toBe(false)
  })

  it('verifies paypal HMAC path when secret provided', async () => {
    const body = JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const secret = 'ppsecret'
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
    const headers = new Headers({ 'PayPal-Transmission-Sig': sig })
    const ok = await verifyPayPal(body, headers, secret)
    expect(ok).toBe(true)
  })

  it('rejects paypal when signature missing', async () => {
    const body = '{}'
    const headers = new Headers()
    const ok = await verifyPayPal(body, headers, 'ppsecret')
    expect(ok).toBe(false)
  })

  it('detects replay via markAndCheck', () => {
    const key = 'stripe:evt_1'
    const first = markAndCheck(key)
    const second = markAndCheck(key)
    expect(first).toBe(false)
    expect(second).toBe(true)
  })

  it('fails cert pin mismatch', async () => {
    process.env.GW_CERT_PIN_SHA256 = 'goodpin'
    vi.resetModules()
    const { noteCert: nc } = await import('../src/webhooks')
    const ok = nc('https://cert.example.com', 'badpin')
    expect(ok).toBe(false)
  })
})
