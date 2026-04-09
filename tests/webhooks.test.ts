import { describe, it, expect, vi } from 'vitest'
import { verifyStripe, verifyPayPal, noteCert } from '../src/webhooks.js'

const stripeSecret = 'whsec_test'

function stripeSig(body: string, ts: number, secret: string) {
  const payload = `${ts}.${body}`
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `t=${ts},v1=${hmac}`
}

import crypto from 'crypto'
import { markAndCheck } from '../src/replay.js'

async function metricValue(name: string) {
  const { toProm } = await import('../src/metrics.js')
  const prom = toProm()
  const line = prom.split('\n').find((l) => l.startsWith(name + ' '))
  if (!line) return 0
  return parseFloat(line.split(' ')[1]) || 0
}

describe('webhook verification', () => {
  it('verifies stripe signature', () => {
    const body = JSON.stringify({ id: 'evt_1', object: 'event' })
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(body, ts, stripeSecret)
    const ok = verifyStripe(body, sig, stripeSecret, 300000)
    expect(ok).toBe(true)
  })

  it('verifies stripe signature with robust header parsing', () => {
    const body = JSON.stringify({ id: 'evt_robust', object: 'event' })
    const ts = Math.floor(Date.now() / 1000)
    const hmac = crypto.createHmac('sha256', stripeSecret).update(`${ts}.${body}`).digest('hex')
    const sig = `v0=legacy, t = ${ts} , v1 = bad , v1 = ${hmac} , extra = field`
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

  it('rejects malformed paypal body without throwing', async () => {
    const headers = new Headers({ 'PayPal-Transmission-Sig': 'deadbeef' })
    await expect(verifyPayPal('{"id":', headers, 'ppsecret')).resolves.toBe(false)
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
    const { noteCert: nc } = await import('../src/webhooks.js')
    const ok = nc('https://cert.example.com', 'badpin')
    expect(ok).toBe(false)
  })

  it('caps cert cache size under churn', async () => {
    process.env.GW_CERT_CACHE_MAX_SIZE = '2'
    process.env.GW_CERT_CACHE_TTL_MS = '600000'
    process.env.GW_CERT_PIN_SHA256 = ''
    process.env.PAYPAL_CERT_ALLOW_PREFIXES = ''
    vi.resetModules()
    const { reset } = await import('../src/metrics.js')
    reset()
    const { noteCert: nc } = await import('../src/webhooks.js')
    expect(nc('https://cert-1.example.com/a.pem', 'pin1')).toBe(true)
    expect(nc('https://cert-2.example.com/b.pem', 'pin2')).toBe(true)
    expect(nc('https://cert-3.example.com/c.pem', 'pin3')).toBe(true)
    expect(await metricValue('gateway_webhook_cert_cache_size')).toBe(2)
  })
})
