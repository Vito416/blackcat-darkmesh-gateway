import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRequest } from '../src/handler.js'

describe('template api policy gateway', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('blocks unknown template action', async () => {
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'evil.exec', payload: {} }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(403)
  })

  it('requires x-template-token when configured', async () => {
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        payload: { host: 'example.com', path: '/' },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(401)
  })

  it('forwards allowed read action to AO endpoint', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        requestId: 'req-1',
        siteId: 'site-1',
        payload: { host: 'example.com', path: '/shop' },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url] = spy.mock.calls[0]
    expect(String(url)).toBe('https://ao.example/api/public/resolve-route')
  })

  it('blocks write actions unless explicitly enabled', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(403)
  })

  it('allows write action when enabled and payload is valid', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url] = spy.mock.calls[0]
    expect(String(url)).toBe('https://write.example/api/checkout/order')
  })

  it('rejects invalid payload shape', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        payload: { host: 'example.com' },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(400)
  })
})
