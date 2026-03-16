import { Buffer } from 'buffer'
import { get, put, sweep, forgetSubject, dropKey } from './cache'
import { inc, gauge, snapshot, toProm } from './metrics'
import { check as rateCheck } from './ratelimit'
import { verifyStripe, verifyPayPal, noteCert } from './webhooks'
import { markAndCheck } from './replay'

async function handleInbox(req: Request): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown'
  if (!rateCheck(`inbox:${ip}`)) {
    inc('gateway_ratelimit_blocked')
    return new Response('Too Many Requests', { status: 429 })
  }
  inc('gateway_inbox_accept')
  // skeleton: just ack
  return new Response('ok', { status: 200 })
}

async function handleCache(req: Request, key: string): Promise<Response> {
  if (req.method === 'PUT') {
    const buf = await req.arrayBuffer()
    const subject = req.headers.get('X-Subject') || undefined
    put(key, buf, subject)
    return new Response('stored', { status: 201 })
  }
  if (req.method === 'GET') {
    const buf = get(key)
    if (!buf) return new Response('miss', { status: 404 })
    return new Response(buf, { status: 200 })
  }
  return new Response('method', { status: 405 })
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/cache/forget')) {
    if (request.method !== 'POST') return new Response('method', { status: 405 })
    const token = process.env.GATEWAY_FORGET_TOKEN
    if (token) {
      const auth = request.headers.get('authorization') || request.headers.get('x-forget-token') || ''
      const presented = auth.replace(/^Bearer\\s+/i, '').trim()
      if (presented !== token) return new Response('unauthorized', { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const subject = body.subject as string | undefined
    const key = body.key as string | undefined
    let removed = 0
    if (subject) removed = forgetSubject(subject)
    if (key) removed = dropKey(key) ? 1 : removed
    return new Response(JSON.stringify({ removed }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (url.pathname.startsWith('/cache/')) {
    const key = url.pathname.replace('/cache/', '')
    return handleCache(request, key)
  }
  if (url.pathname === '/inbox') {
    return handleInbox(request)
  }
  if (url.pathname === '/metrics') {
    const needBasic = !!(process.env.METRICS_BASIC_USER && process.env.METRICS_BASIC_PASS)
    const needBearer = !!process.env.METRICS_BEARER_TOKEN
    if (needBasic || needBearer) {
      const auth = request.headers.get('authorization') || ''
      const alt = request.headers.get('x-metrics-token') || ''
      let authed = false
      if (needBearer && /^Bearer\\s+/i.test(auth)) {
        authed = auth.replace(/^Bearer\\s+/i, '').trim() === process.env.METRICS_BEARER_TOKEN
      }
      if (needBearer && !authed && alt) {
        authed = alt === process.env.METRICS_BEARER_TOKEN
      }
      if (!authed && needBasic && /^Basic\\s+/i.test(auth)) {
        const b64 = auth.replace(/^Basic\\s+/i, '')
        try {
          const decoded = Buffer.from(b64, 'base64').toString()
          const [user, pass] = decoded.split(':')
          if (user === process.env.METRICS_BASIC_USER && pass === process.env.METRICS_BASIC_PASS) authed = true
        } catch (_) { /* ignore */ }
      }
      if (!authed) {
        return new Response('unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm=\"metrics\"' } })
      }
    }
    const prom = toProm()
    return new Response(prom, { status: 200, headers: { 'content-type': 'text/plain; version=0.0.4' } })
  }
  if (url.pathname === '/webhook/stripe') {
    const body = await request.text()
    const ok = verifyStripe(body, request.headers.get('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET || '', parseInt(process.env.STRIPE_WEBHOOK_TOLERANCE_MS || '300000', 10))
    if (!ok) {
      inc('gateway_webhook_stripe_verify_fail')
      const shadow = process.env.GATEWAY_WEBHOOK_SHADOW_INVALID === '1'
      return new Response('sig invalid', { status: shadow ? 202 : 401 })
    }
    const id = (() => { try { return JSON.parse(body)?.id as string } catch { return undefined } })()
    if (id && markAndCheck(`stripe:${id}`)) return new Response('replay', { status: 200 })
    inc('gateway_webhook_stripe_ok')
    return new Response('ok', { status: 200 })
  }
  if (url.pathname === '/webhook/paypal') {
    const body = await request.text()
    const headers = request.headers
    const certOk = noteCert(headers.get('PayPal-Cert-Url') || undefined, headers.get('PayPal-Cert-Sha256') || undefined)
    const ok = await verifyPayPal(body, headers, process.env.PAYPAL_WEBHOOK_SECRET || undefined)
    if (!ok || !certOk) {
      inc('gateway_webhook_paypal_verify_fail')
      const shadow = process.env.GATEWAY_WEBHOOK_SHADOW_INVALID === '1'
      return new Response('sig invalid', { status: shadow ? 202 : 401 })
    }
    const replayKey = headers.get('PayPal-Transmission-Id') || headers.get('Paypal-Transmission-Id')
    if (replayKey && markAndCheck(`paypal:${replayKey}`)) return new Response('replay', { status: 200 })
    inc('gateway_webhook_paypal_ok')
    return new Response('ok', { status: 200 })
  }
  // periodic sweep
  sweep()
  return new Response('Gateway skeleton', { status: 200 })
}
