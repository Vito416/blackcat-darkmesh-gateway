import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('handler cache and shadow modes', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('requires token for /cache/forget', async () => {
    process.env.GATEWAY_FORGET_TOKEN = 'secret'
    const { handleRequest } = await import('../src/handler.js')
    // store value with subject
    const putReq = new Request('http://gateway/cache/foo', { method: 'PUT', body: 'abc', headers: { 'content-type': 'application/octet-stream', 'x-subject': 'subj1' } })
    await handleRequest(putReq)
    const forgetReqNoAuth = new Request('http://gateway/cache/forget', { method: 'POST', body: JSON.stringify({ subject: 'subj1' }), headers: { 'content-type': 'application/json' } })
    const resNo = await handleRequest(forgetReqNoAuth)
    expect(resNo.status).toBe(401)
    const forgetReq = new Request('http://gateway/cache/forget', { method: 'POST', body: JSON.stringify({ subject: 'subj1' }), headers: { 'content-type': 'application/json', 'x-forget-token': 'secret' } })
    const res = await handleRequest(forgetReq)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe(1)
  })

  it('shadow mode returns 202 on invalid stripe sig', async () => {
    process.env.GATEWAY_WEBHOOK_SHADOW_INVALID = '1'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const { handleRequest } = await import('../src/handler.js')
    const badSigReq = new Request('http://gateway/webhook/stripe', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=0,v1=badsig' } })
    const res = await handleRequest(badSigReq)
    expect(res.status).toBe(202)
  })

  it('returns 507 when cache admission limits reject PUT', async () => {
    process.env.GATEWAY_CACHE_MAX_ENTRY_BYTES = '2'
    const metrics = await import('../src/metrics.js')
    metrics.reset()
    const { handleRequest } = await import('../src/handler.js')
    const putReq = new Request('http://gateway/cache/too-large', {
      method: 'PUT',
      body: 'abc',
      headers: { 'content-type': 'application/octet-stream' },
    })
    const res = await handleRequest(putReq)
    expect(res.status).toBe(507)
    await expect(res.json()).resolves.toEqual({ error: 'cache_budget_exceeded' })
    const state = metrics.snapshot()
    expect(state.counters.gateway_cache_store_reject).toBe(1)
    expect(state.counters.gateway_cache_store_reject_size).toBe(1)
  })
})
