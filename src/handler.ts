import { get, put, sweep } from './cache'
import { inc, gauge, snapshot, toProm } from './metrics'
import { check as rateCheck } from './ratelimit'
import { verifyStripe, verifyPayPal, noteCert } from './webhooks'

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
    put(key, buf)
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
  if (url.pathname.startsWith('/cache/')) {
    const key = url.pathname.replace('/cache/', '')
    return handleCache(request, key)
  }
  if (url.pathname === '/inbox') {
    return handleInbox(request)
  }
  if (url.pathname === '/metrics') {
    const prom = toProm()
    return new Response(prom, { status: 200, headers: { 'content-type': 'text/plain; version=0.0.4' } })
  }
  if (url.pathname === '/webhook/stripe') {
    const body = await request.text()
    const ok = verifyStripe(body, request.headers.get('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET || '', parseInt(process.env.STRIPE_WEBHOOK_TOLERANCE_MS || '300000', 10))
    if (!ok) { inc('gateway_webhook_stripe_verify_fail'); return new Response('sig invalid', { status: 401 }) }
    inc('gateway_webhook_stripe_ok')
    return new Response('ok', { status: 200 })
  }
  if (url.pathname === '/webhook/paypal') {
    const body = await request.text()
    const headers = request.headers
    noteCert(headers.get('PayPal-Cert-Url') || undefined)
    const ok = await verifyPayPal(body, headers, process.env.PAYPAL_WEBHOOK_SECRET || undefined)
    if (!ok) { inc('gateway_webhook_paypal_verify_fail'); return new Response('sig invalid', { status: 401 }) }
    inc('gateway_webhook_paypal_ok')
    return new Response('ok', { status: 200 })
  }
  // periodic sweep
  sweep()
  return new Response('Gateway skeleton', { status: 200 })
}
