import { describe, expect, it } from 'vitest'

import { handleRequest } from '../src/handler.js'

describe('template config/public route guardrails', () => {
  it('returns structured template config payload', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.WORKER_API_URL = 'https://worker.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'

    const res = await handleRequest(new Request('http://gateway/template/config'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('application/json')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.contractActions)).toBe(true)
    expect(body.contractActions.some((item: any) => item.action === 'public.resolve-route')).toBe(true)
    expect(body.contractActions.some((item: any) => item.action === 'checkout.create-order')).toBe(true)
  })

  it('rejects query strings on template config and template call endpoints', async () => {
    const configRes = await handleRequest(new Request('http://gateway/template/config?probe=1'))
    expect(configRes.status).toBe(400)
    await expect(configRes.json()).resolves.toEqual({ error: 'query_not_allowed' })

    const callRes = await handleRequest(new Request('http://gateway/template/call?probe=1', { method: 'POST' }))
    expect(callRes.status).toBe(400)
    await expect(callRes.json()).resolves.toEqual({ error: 'query_not_allowed' })
  })

  it('returns 404 for unknown paths', async () => {
    const res = await handleRequest(new Request('http://gateway/no-such-path'))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('not found')
  })
})
