import { get, put, sweep } from './cache'
import { inc, gauge, snapshot } from './metrics'
import { check as rateCheck } from './ratelimit'

async function handleInbox(req: Request): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown'
  if (!rateCheck(`inbox:${ip}`)) {
    return new Response('Too Many Requests', { status: 429 })
  }
  inc('gateway.inbox.accept')
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
    const snap = snapshot()
    return new Response(JSON.stringify(snap), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  // periodic sweep
  sweep()
  return new Response('Gateway skeleton', { status: 200 })
}
