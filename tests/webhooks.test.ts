import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
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

async function loadHandler() {
  vi.resetModules()
  return import('../src/handler.js')
}

beforeEach(async () => {
  const { reset } = await import('../src/metrics.js')
  reset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete process.env.GATEWAY_WEBHOOK_MAX_BODY_BYTES
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.PAYPAL_WEBHOOK_SECRET
  delete process.env.GW_CERT_PIN_SHA256
  delete process.env.GW_CERT_CACHE_MAX_SIZE
  delete process.env.GW_CERT_CACHE_TTL_MS
  delete process.env.PAYPAL_CERT_ALLOW_PREFIXES
  delete process.env.GW_STRIPE_SIGNATURE_HEADER_MAX_BYTES
  delete process.env.PAYPAL_WEBHOOK_ID
  delete process.env.PAYPAL_API_BASE
  delete process.env.PAYPAL_API_ALLOW_HOSTS
  delete process.env.PAYPAL_HTTP_TIMEOUT_MS
  delete process.env.PAYPAL_CLIENT_ID
  delete process.env.PAYPAL_CLIENT_SECRET
  delete process.env.GATEWAY_RL_MAX
  vi.resetModules()
})

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

  it('rejects oversized stripe signature headers', async () => {
    process.env.GW_STRIPE_SIGNATURE_HEADER_MAX_BYTES = '256'
    vi.resetModules()
    const { verifyStripe: vs } = await import('../src/webhooks.js')
    const body = JSON.stringify({ id: 'evt_big', object: 'event' })
    const ts = Math.floor(Date.now() / 1000)
    const hmac = crypto.createHmac('sha256', stripeSecret).update(`${ts}.${body}`).digest('hex')
    const sig = `t=${ts},v1=${hmac},v1=${'a'.repeat(300)}`
    expect(sig.length).toBeGreaterThan(256)
    const ok = vs(body, sig, stripeSecret, 300000)
    expect(ok).toBe(false)
  })

  it('verifies paypal HMAC path when secret provided', async () => {
    const body = JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const secret = 'ppsecret'
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
    const headers = new Headers({
      'PayPal-Transmission-Sig': sig,
      'PayPal-Cert-Url': 'https://api.paypal.com/certs/wh.pem',
    })
    const ok = await verifyPayPal(body, headers, secret)
    expect(ok).toBe(true)
  })

  it('rejects non-https paypal api bases without calling fetch', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'wh_123'
    process.env.PAYPAL_API_BASE = 'http://api.sandbox.paypal.com'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify({ id: 'WH-http', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const headers = new Headers({
      'PayPal-Cert-Url': 'https://api.paypal.com/certs/wh.pem',
      'PayPal-Transmission-Sig': 'deadbeef',
      'PayPal-Transmission-Id': 'tx-http',
      'PayPal-Transmission-Time': '2026-04-09T00:00:00Z',
      'PayPal-Auth-Algo': 'SHA256withRSA',
    })
    await expect(verifyPayPal(body, headers)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('respects paypal api host allowlists and accepts configured hosts', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'wh_123'
    process.env.PAYPAL_CLIENT_ID = 'client'
    process.env.PAYPAL_CLIENT_SECRET = 'secret'
    process.env.PAYPAL_API_BASE = 'https://api.sandbox.paypal.com'
    process.env.PAYPAL_API_ALLOW_HOSTS = 'api.sandbox.paypal.com'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verification_status: 'SUCCESS' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify({ id: 'WH-remote', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const headers = new Headers({
      'PayPal-Cert-Url': 'https://api.paypal.com/certs/wh.pem',
      'PayPal-Transmission-Sig': 'sig',
      'PayPal-Transmission-Id': 'tx-remote',
      'PayPal-Transmission-Time': '2026-04-09T00:00:00Z',
      'PayPal-Auth-Algo': 'SHA256withRSA',
    })
    await expect(verifyPayPal(body, headers)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('blocks paypal api hosts not on the allowlist', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'wh_123'
    process.env.PAYPAL_API_BASE = 'https://evil.example'
    process.env.PAYPAL_API_ALLOW_HOSTS = 'api.sandbox.paypal.com'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify({ id: 'WH-host', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const headers = new Headers({
      'PayPal-Cert-Url': 'https://api.paypal.com/certs/wh.pem',
      'PayPal-Transmission-Sig': 'sig',
      'PayPal-Transmission-Id': 'tx-host',
      'PayPal-Transmission-Time': '2026-04-09T00:00:00Z',
      'PayPal-Auth-Algo': 'SHA256withRSA',
    })
    await expect(verifyPayPal(body, headers)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out paypal remote verification without throwing', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'wh_123'
    process.env.PAYPAL_CLIENT_ID = 'client'
    process.env.PAYPAL_CLIENT_SECRET = 'secret'
    process.env.PAYPAL_API_BASE = 'https://api.sandbox.paypal.com'
    process.env.PAYPAL_API_ALLOW_HOSTS = 'api.sandbox.paypal.com'
    process.env.PAYPAL_HTTP_TIMEOUT_MS = '5'
    const fetchMock = vi.fn((_, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        const timer = setTimeout(() => {
          _resolve(
            new Response(JSON.stringify({ access_token: 'late-token' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }, 1000)
        const onAbort = () => {
          clearTimeout(timer)
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }
        if (signal) {
          if (signal.aborted) {
            onAbort()
            return
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify({ id: 'WH-timeout', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const headers = new Headers({
      'PayPal-Cert-Url': 'https://api.paypal.com/certs/wh.pem',
      'PayPal-Transmission-Sig': 'sig',
      'PayPal-Transmission-Id': 'tx-timeout',
      'PayPal-Transmission-Time': '2026-04-09T00:00:00Z',
      'PayPal-Auth-Algo': 'SHA256withRSA',
    })
    await expect(verifyPayPal(body, headers)).resolves.toBe(false)
  })

  it('rejects malformed paypal body without throwing', async () => {
    const headers = new Headers({ 'PayPal-Transmission-Sig': 'deadbeef' })
    await expect(verifyPayPal('{"id":', headers, 'ppsecret')).resolves.toBe(false)
  })

  it('rejects malformed paypal cert urls before remote verification', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'wh_123'
    const body = JSON.stringify({ id: 'WH-2', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const headers = new Headers({
      'PayPal-Cert-Url': 'not-a-url',
      'PayPal-Transmission-Sig': 'deadbeef',
      'PayPal-Transmission-Id': 'tx-1',
      'PayPal-Transmission-Time': '2026-04-09T00:00:00Z',
      'PayPal-Auth-Algo': 'SHA256withRSA',
    })
    await expect(verifyPayPal(body, headers)).resolves.toBe(false)
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

  it('clamps cert cache ttl to a sane minimum', async () => {
    process.env.GW_CERT_CACHE_TTL_MS = '1'
    process.env.GW_CERT_CACHE_MAX_SIZE = '8'
    process.env.GW_CERT_PIN_SHA256 = ''
    process.env.PAYPAL_CERT_ALLOW_PREFIXES = ''
    vi.resetModules()
    const { reset } = await import('../src/metrics.js')
    reset()
    const { noteCert: nc } = await import('../src/webhooks.js')
    vi.useFakeTimers()
    vi.setSystemTime(0)
    expect(nc('https://cert-1.example.com/a.pem', 'pin1')).toBe(true)
    expect(await metricValue('gateway_webhook_cert_cache_size')).toBe(1)
    vi.setSystemTime(10)
    expect(nc('https://cert-2.example.com/b.pem', 'pin2')).toBe(true)
    expect(await metricValue('gateway_webhook_cert_cache_size')).toBe(2)
  })

  it('rejects oversized stripe webhook bodies before verification', async () => {
    process.env.GATEWAY_WEBHOOK_MAX_BODY_BYTES = '64'
    process.env.STRIPE_WEBHOOK_SECRET = stripeSecret
    vi.resetModules()
    const { handleRequest } = await loadHandler()

    const body = JSON.stringify({
      id: 'evt_big',
      object: 'event',
      details: 'x'.repeat(256),
    })
    const ts = Math.floor(Date.now() / 1000)
    const headers = new Headers({
      'Stripe-Signature': stripeSig(body, ts, stripeSecret),
    })
    const res = await handleRequest(new Request('http://gateway/webhook/stripe', { method: 'POST', body, headers }))

    expect(res.status).toBe(413)
    await expect(res.text()).resolves.toBe('payload too large')
    expect(await metricValue('gateway_webhook_reject_size_total')).toBe(1)
  })

  it('rejects oversized paypal webhook bodies before verification', async () => {
    process.env.GATEWAY_WEBHOOK_MAX_BODY_BYTES = '64'
    process.env.PAYPAL_WEBHOOK_SECRET = 'ppsecret'
    vi.resetModules()
    const { handleRequest } = await loadHandler()

    const body = JSON.stringify({
      id: 'WH-big',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      details: 'x'.repeat(256),
    })
    const headers = new Headers({
      'PayPal-Transmission-Sig': crypto.createHmac('sha256', 'ppsecret').update(body).digest('hex'),
    })
    const res = await handleRequest(new Request('http://gateway/webhook/paypal', { method: 'POST', body, headers }))

    expect(res.status).toBe(413)
    await expect(res.text()).resolves.toBe('payload too large')
    expect(await metricValue('gateway_webhook_reject_size_total')).toBe(1)
  })

  it('still accepts valid stripe webhook bodies under the size limit', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = stripeSecret
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ id: 'evt_ok', object: 'event' })
    const ts = Math.floor(Date.now() / 1000)
    const headers = new Headers({ 'Stripe-Signature': stripeSig(body, ts, stripeSecret) })
    const res = await handleRequest(new Request('http://gateway/webhook/stripe', { method: 'POST', body, headers }))
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('ok')
  })

  it('still accepts valid paypal webhook bodies under the size limit', async () => {
    process.env.PAYPAL_WEBHOOK_SECRET = 'ppsecret'
    const { handleRequest } = await loadHandler()
    const body = JSON.stringify({ id: 'WH-ok', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const headers = new Headers({
      'PayPal-Transmission-Sig': crypto.createHmac('sha256', 'ppsecret').update(body).digest('hex'),
    })
    const res = await handleRequest(new Request('http://gateway/webhook/paypal', { method: 'POST', body, headers }))
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('ok')
  })

  it('rate limits stripe and paypal webhooks per IP before verification', async () => {
    process.env.GATEWAY_RL_MAX = '1'
    process.env.STRIPE_WEBHOOK_SECRET = stripeSecret
    process.env.PAYPAL_WEBHOOK_SECRET = 'ppsecret'
    const { handleRequest } = await loadHandler()
    const ipHeaders = { 'CF-Connecting-IP': '198.51.100.22' }

    const stripeBody = JSON.stringify({ id: 'evt_rl', object: 'event' })
    const stripeTs = Math.floor(Date.now() / 1000)
    const stripeHeaders = new Headers({
      ...ipHeaders,
      'Stripe-Signature': stripeSig(stripeBody, stripeTs, stripeSecret),
    })
    const firstStripe = await handleRequest(
      new Request('http://gateway/webhook/stripe', { method: 'POST', body: stripeBody, headers: stripeHeaders }),
    )
    expect(firstStripe.status).toBe(200)

    const secondStripe = await handleRequest(
      new Request('http://gateway/webhook/stripe', { method: 'POST', body: stripeBody, headers: stripeHeaders }),
    )
    expect(secondStripe.status).toBe(429)
    await expect(secondStripe.text()).resolves.toBe('Too Many Requests')

    const paypalBody = JSON.stringify({ id: 'WH-rl', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const paypalHeaders = new Headers({
      ...ipHeaders,
      'PayPal-Transmission-Sig': crypto.createHmac('sha256', 'ppsecret').update(paypalBody).digest('hex'),
    })
    const firstPaypal = await handleRequest(
      new Request('http://gateway/webhook/paypal', { method: 'POST', body: paypalBody, headers: paypalHeaders }),
    )
    expect(firstPaypal.status).toBe(200)

    const secondPaypal = await handleRequest(
      new Request('http://gateway/webhook/paypal', { method: 'POST', body: paypalBody, headers: paypalHeaders }),
    )
    expect(secondPaypal.status).toBe(429)
    await expect(secondPaypal.text()).resolves.toBe('Too Many Requests')
  })
})
