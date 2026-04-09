import { Buffer } from 'buffer'
import crypto from 'crypto'
import { get, put, sweep, forgetSubject, dropKey } from './cache.js'
import { inc, gauge, snapshot, toProm } from './metrics.js'
import { check as rateCheck } from './ratelimit.js'
import { verifyStripe, verifyPayPal, noteCert } from './webhooks.js'
import { markAndCheck } from './replay.js'
import { proxyTemplateCall } from './templateApi.js'

type WebhookProvider = 'stripe' | 'paypal' | 'gopay'

function recordWebhook5xx(provider: WebhookProvider) {
  inc(`gateway_webhook_${provider}_5xx`)
}

async function wrapWebhook(provider: WebhookProvider, fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    const res = await fn()
    if (res.status >= 500) recordWebhook5xx(provider)
    return res
  } catch (_) {
    recordWebhook5xx(provider)
    return new Response('error', { status: 500 })
  }
}

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

async function handleTemplateCall(req: Request): Promise<Response> {
  inc('gateway_template_call')
  if (req.method !== 'POST') return new Response('method', { status: 405 })

  const requiredToken = process.env.GATEWAY_TEMPLATE_TOKEN
  if (requiredToken) {
    const presented = (req.headers.get('x-template-token') || '').trim()
    if (presented !== requiredToken) {
      inc('gateway_template_call_blocked')
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    inc('gateway_template_call_blocked')
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const action = String((body as any).action || '').trim()
  const payload = (body as any).payload
  if (!action) {
    inc('gateway_template_call_blocked')
    return new Response(JSON.stringify({ error: 'action_required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const res = await proxyTemplateCall({
    action,
    payload,
    requestId: typeof (body as any).requestId === 'string' ? (body as any).requestId : undefined,
    siteId: typeof (body as any).siteId === 'string' ? (body as any).siteId : undefined,
    actor: typeof (body as any).actor === 'string' ? (body as any).actor : undefined,
  })

  if (res.status >= 200 && res.status < 300) {
    inc('gateway_template_call_ok')
  } else if (res.status >= 500) {
    inc('gateway_template_call_backend_fail')
  } else {
    inc('gateway_template_call_blocked')
  }

  return res
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/cache/forget')) {
    if (request.method !== 'POST') return new Response('method', { status: 405 })
    const token = process.env.GATEWAY_FORGET_TOKEN
    if (token) {
      const auth = request.headers.get('authorization') || request.headers.get('x-forget-token') || ''
      const presented = auth.replace(/^Bearer\s+/i, '').trim()
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
  if (url.pathname === '/template/call') {
    return handleTemplateCall(request)
  }
  if (url.pathname === '/metrics') {
    const needBasic = !!(process.env.METRICS_BASIC_USER && process.env.METRICS_BASIC_PASS)
    const needBearer = !!process.env.METRICS_BEARER_TOKEN
    const mustGuard = process.env.GATEWAY_REQUIRE_METRICS_AUTH !== '0'
    if (!needBasic && !needBearer && mustGuard) {
      return new Response('metrics_auth_not_configured', { status: 500 })
    }
    if (needBasic || needBearer || mustGuard) {
      const auth = request.headers.get('authorization') || ''
      const alt = request.headers.get('x-metrics-token') || ''
      let authed = false
      if (needBearer && /^Bearer\s+/i.test(auth)) {
        authed = auth.replace(/^Bearer\s+/i, '').trim() === process.env.METRICS_BEARER_TOKEN
      }
      if (needBearer && !authed && alt) {
        authed = alt === process.env.METRICS_BEARER_TOKEN
      }
      if (!authed && needBasic && /^Basic\s+/i.test(auth)) {
        const b64 = auth.replace(/^Basic\s+/i, '')
        try {
          const decoded = Buffer.from(b64, 'base64').toString()
          const [user, pass] = decoded.split(':')
          if (user === process.env.METRICS_BASIC_USER && pass === process.env.METRICS_BASIC_PASS) authed = true
        } catch (_) { /* ignore */ }
      }
      if (!authed) {
        inc('gateway_metrics_auth_blocked')
        return new Response('unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm=\"metrics\"' } })
      }
    }
    const prom = toProm()
    return new Response(prom, { status: 200, headers: { 'content-type': 'text/plain; version=0.0.4' } })
  }
  if (url.pathname === '/webhook/stripe') {
    return wrapWebhook('stripe', async () => {
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
    })
  }
  if (url.pathname === '/webhook/paypal') {
    return wrapWebhook('paypal', async () => {
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
    })
  }

  if (url.pathname === '/webhook/demo-forward') {
    const target = process.env.WORKER_NOTIFY_URL || 'http://localhost:8787/notify'
    const token = process.env.WORKER_AUTH_TOKEN || process.env.WORKER_NOTIFY_TOKEN || 'test-notify'
    const hmacSecret = process.env.WORKER_NOTIFY_HMAC || ''
    const body = await request.text()

    // Pick breaker key by provider (query/header/body) with per-PSP overrides, fallback to generic.
    const provider = (() => {
      const q = url.searchParams.get('provider')
      if (q) return q.toLowerCase()
      const hdr = request.headers.get('x-provider')
      if (hdr) return hdr.toLowerCase()
      try {
        const parsed = JSON.parse(body)
        if (parsed?.provider) return String(parsed.provider).toLowerCase()
      } catch {}
      return undefined
    })()

    const breakerKey = (() => {
      if (provider === 'stripe' && process.env.WORKER_NOTIFY_BREAKER_KEY_STRIPE) return process.env.WORKER_NOTIFY_BREAKER_KEY_STRIPE
      if (provider === 'paypal' && process.env.WORKER_NOTIFY_BREAKER_KEY_PAYPAL) return process.env.WORKER_NOTIFY_BREAKER_KEY_PAYPAL
      if (provider === 'gopay' && process.env.WORKER_NOTIFY_BREAKER_KEY_GOPAY) return process.env.WORKER_NOTIFY_BREAKER_KEY_GOPAY
      return process.env.WORKER_NOTIFY_BREAKER_KEY || provider || 'gateway'
    })()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-breaker-key': breakerKey,
    }
    if (hmacSecret) {
      const sig = crypto.createHmac('sha256', hmacSecret).update(body).digest('hex')
      headers['X-Signature'] = sig
    }
    const resp = await fetch(target, { method: 'POST', headers, body })
    if (resp.ok) return new Response('forwarded', { status: 200 })
    return new Response('notify_failed', { status: 502 })
  }
  // periodic sweep
  sweep()
  return new Response('Gateway skeleton', { status: 200 })
}
