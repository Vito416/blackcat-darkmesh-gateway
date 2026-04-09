import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reset, snapshot } from '../src/metrics.js'

describe('integrity policy gate', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    reset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    reset()
  })

  async function loadHandler() {
    return import('../src/handler.js')
  }

  function makeTemplateWriteRequest() {
    return new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
  }

  function makeTemplateReadRequest() {
    return new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        payload: { host: 'example.com', path: '/' },
      }),
    })
  }

  it('blocks mutating paths when the policy is paused and keeps read-only paths available', async () => {
    process.env.GATEWAY_INTEGRITY_POLICY_PAUSED = '1'
    process.env.METRICS_BEARER_TOKEN = 'metrics-secret'
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { handleRequest } = await loadHandler()

    const rootRes = await handleRequest(new Request('http://gateway/'))
    expect(rootRes.status).toBe(200)
    expect(await rootRes.text()).toBe('Gateway skeleton')

    const cacheGetRes = await handleRequest(new Request('http://gateway/cache/foo'))
    expect(cacheGetRes.status).toBe(404)

    const metricsRes = await handleRequest(
      new Request('http://gateway/metrics', {
        headers: { authorization: 'Bearer metrics-secret' },
      }),
    )
    expect(metricsRes.status).toBe(200)

    const templateReadRes = await handleRequest(makeTemplateReadRequest())
    expect(templateReadRes.status).toBe(200)

    const templateWriteRes = await handleRequest(makeTemplateWriteRequest())
    expect(templateWriteRes.status).toBe(503)
    await expect(templateWriteRes.json()).resolves.toEqual({ error: 'policy_paused' })

    const cachePutRes = await handleRequest(
      new Request('http://gateway/cache/foo', {
        method: 'PUT',
        body: 'abc',
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    expect(cachePutRes.status).toBe(503)
    await expect(cachePutRes.json()).resolves.toEqual({ error: 'policy_paused' })

    const inboxRes = await handleRequest(
      new Request('http://gateway/inbox', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(inboxRes.status).toBe(503)

    const demoForwardRes = await handleRequest(
      new Request('http://gateway/webhook/demo-forward', {
        method: 'POST',
        body: JSON.stringify({ provider: 'stripe' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(demoForwardRes.status).toBe(503)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const state = snapshot()
    expect(state.gauges.gateway_integrity_policy_paused).toBe(1)
    expect(state.counters.gateway_integrity_fallback_readonly).toBeGreaterThanOrEqual(4)
    expect(state.counters.gateway_integrity_unverified_block).toBeGreaterThanOrEqual(4)
  })

  it('honors JSON policy overrides over the env fallback', async () => {
    process.env.GATEWAY_INTEGRITY_POLICY_PAUSED = '1'
    process.env.GATEWAY_INTEGRITY_POLICY_JSON = JSON.stringify({ paused: false })
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.WRITE_API_URL = 'https://write.example'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const { handleRequest } = await loadHandler()

    const res = await handleRequest(makeTemplateWriteRequest())
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const state = snapshot()
    expect(state.gauges.gateway_integrity_policy_paused).toBe(0)
    expect(state.counters.gateway_integrity_unverified_block || 0).toBe(0)
  })

  it('falls back to the env flag when policy JSON is malformed', async () => {
    process.env.GATEWAY_INTEGRITY_POLICY_PAUSED = '1'
    process.env.GATEWAY_INTEGRITY_POLICY_JSON = '{bad-json'
    const { handleRequest } = await loadHandler()

    const res = await handleRequest(
      new Request('http://gateway/cache/foo', {
        method: 'PUT',
        body: 'abc',
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'policy_paused' })
    expect(snapshot().gauges.gateway_integrity_policy_paused).toBe(1)
  })
})
