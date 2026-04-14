import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('handler cache and shadow modes', () => {
  const originalEnv = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.resetModules()
    delete process.env.GATEWAY_FORGET_FORWARD_URL
    delete process.env.GATEWAY_FORGET_FORWARD_TOKEN
    delete process.env.GATEWAY_FORGET_FORWARD_TIMEOUT_MS
    delete process.env.AO_INTEGRITY_URL
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_PATH
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_SECRET
    delete process.env.GATEWAY_INTEGRITY_DISKLESS
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_MODE
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
  })

  it(
    'requires token for /cache/forget',
    { timeout: 15000 },
    async () => {
    process.env.GATEWAY_FORGET_TOKEN = 'secret'
    const { handleRequest } = await import('../src/handler.js')
    // store value with subject
    const putReq = new Request('http://gateway/cache/foo', { method: 'PUT', body: 'abc', headers: { 'content-type': 'application/octet-stream', 'x-subject': 'subj1' } })
    await handleRequest(putReq)
    const forgetReqNoAuth = new Request('http://gateway/cache/forget', { method: 'POST', body: JSON.stringify({ subject: 'subj1' }), headers: { 'content-type': 'application/json' } })
    const resNo = await handleRequest(forgetReqNoAuth)
    expect(resNo.status).toBe(401)
    expect(resNo.headers.get('cache-control')).toBe('no-store')
    const forgetReqBadBearer = new Request('http://gateway/cache/forget', {
      method: 'POST',
      body: JSON.stringify({ subject: 'subj1' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    })
    const resBadBearer = await handleRequest(forgetReqBadBearer)
    expect(resBadBearer.status).toBe(401)
    expect(resBadBearer.headers.get('cache-control')).toBe('no-store')
    const forgetReq = new Request('http://gateway/cache/forget', { method: 'POST', body: JSON.stringify({ subject: 'subj1' }), headers: { 'content-type': 'application/json', 'x-forget-token': 'secret' } })
    const res = await handleRequest(forgetReq)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.removed).toBe(1)
    expect(body.forwarded).toBe(false)
    },
  )

  it('fails closed for internal mutation routes by default in production-like mode', async () => {
    process.env.GATEWAY_PRODUCTION_LIKE = '1'
    const { handleRequest } = await import('../src/handler.js')

    const cacheRes = await handleRequest(
      new Request('http://gateway/cache/foo', {
        method: 'PUT',
        body: 'abc',
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    expect(cacheRes.status).toBe(404)
    expect(cacheRes.headers.get('cache-control')).toBe('no-store')

    const forgetRes = await handleRequest(
      new Request('http://gateway/cache/forget', {
        method: 'POST',
        body: JSON.stringify({ key: 'foo' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(forgetRes.status).toBe(404)
    expect(forgetRes.headers.get('cache-control')).toBe('no-store')

    const inboxRes = await handleRequest(
      new Request('http://gateway/inbox', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(inboxRes.status).toBe(404)
    expect(inboxRes.headers.get('cache-control')).toBe('no-store')
  })

  it('allows internal routes in production-like mode only with explicit opt-in toggles', async () => {
    process.env.GATEWAY_PRODUCTION_LIKE = '1'
    process.env.GATEWAY_INTERNAL_PLANE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_FORGET_TOKEN = 'secret'
    const { handleRequest } = await import('../src/handler.js')

    const cachePutRes = await handleRequest(
      new Request('http://gateway/cache/foo', {
        method: 'PUT',
        body: 'abc',
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    expect(cachePutRes.status).toBe(201)

    const forgetRes = await handleRequest(
      new Request('http://gateway/cache/forget', {
        method: 'POST',
        body: JSON.stringify({ key: 'foo' }),
        headers: { 'content-type': 'application/json', 'x-forget-token': 'secret' },
      }),
    )
    expect(forgetRes.status).toBe(200)

    const inboxRes = await handleRequest(
      new Request('http://gateway/inbox', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(inboxRes.status).toBe(200)
  })

  it('requires forget token configuration when production-like overrides are enabled', async () => {
    process.env.GATEWAY_PRODUCTION_LIKE = '1'
    process.env.GATEWAY_INTERNAL_PLANE_ALLOW_FORGET = '1'
    delete process.env.GATEWAY_FORGET_TOKEN
    const { handleRequest } = await import('../src/handler.js')

    const forgetRes = await handleRequest(
      new Request('http://gateway/cache/forget', {
        method: 'POST',
        body: JSON.stringify({ key: 'foo' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(forgetRes.status).toBe(500)
    expect(forgetRes.headers.get('cache-control')).toBe('no-store')
    await expect(forgetRes.text()).resolves.toBe('forget_auth_not_configured')
  })

  it(
    'forwards cache forget events when configured',
    { timeout: 15000 },
    async () => {
    process.env.GATEWAY_FORGET_TOKEN = 'secret'
    process.env.GATEWAY_FORGET_FORWARD_URL = 'https://worker.example/cache/forget'
    process.env.GATEWAY_FORGET_FORWARD_TOKEN = 'forward-secret'
    const { handleRequest } = await import('../src/handler.js')

    const putReq = new Request('http://gateway/cache/foo', {
      method: 'PUT',
      body: 'abc',
      headers: { 'content-type': 'application/octet-stream', 'x-subject': 'subj1' },
    })
    await handleRequest(putReq)

    const forgetReq = new Request('http://gateway/cache/forget', {
      method: 'POST',
      body: JSON.stringify({ subject: 'subj1', key: 'foo' }),
      headers: { 'content-type': 'application/json', 'x-forget-token': 'secret' },
    })
    const res = await handleRequest(forgetReq)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe(1)
    expect(body.forwarded).toBe(true)
    const forwardCall = fetchMock.mock.calls.find(([url]) => String(url) === 'https://worker.example/cache/forget')
    expect(forwardCall).toBeDefined()
    const [, init] = forwardCall || []
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer forward-secret',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      subject: 'subj1',
      key: 'foo',
      removed: 1,
    })
    },
  )

  it('uses timing-safe matching for metrics auth tokens', async () => {
    process.env.GATEWAY_REQUIRE_METRICS_AUTH = '1'
    process.env.METRICS_BEARER_TOKEN = 'metrics-secret'
    process.env.METRICS_BASIC_USER = 'metrics-user'
    process.env.METRICS_BASIC_PASS = 'metrics-pass'
    const { handleRequest } = await import('../src/handler.js')

    const badBearerRes = await handleRequest(
      new Request('http://gateway/metrics', {
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(badBearerRes.status).toBe(401)
    expect(badBearerRes.headers.get('cache-control')).toBe('no-store')

    const badBasic = Buffer.from('metrics-user:wrong-pass').toString('base64')
    const badBasicRes = await handleRequest(
      new Request('http://gateway/metrics', {
        headers: { authorization: `Basic ${badBasic}` },
      }),
    )
    expect(badBasicRes.status).toBe(401)
    expect(badBasicRes.headers.get('cache-control')).toBe('no-store')

    const headerRes = await handleRequest(
      new Request('http://gateway/metrics', {
        headers: { 'x-metrics-token': 'metrics-secret' },
      }),
    )
    expect(headerRes.status).toBe(200)
    expect(headerRes.headers.get('cache-control')).toBe('no-store')

    const basic = Buffer.from('metrics-user:metrics-pass').toString('base64')
    const basicRes = await handleRequest(
      new Request('http://gateway/metrics', {
        headers: { authorization: `Basic ${basic}` },
      }),
    )
    expect(basicRes.status).toBe(200)
    expect(basicRes.headers.get('cache-control')).toBe('no-store')
  })

  it('shadow mode returns 202 on invalid stripe sig', async () => {
    process.env.GATEWAY_WEBHOOK_SHADOW_INVALID = '1'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const { handleRequest } = await import('../src/handler.js')
    const badSigReq = new Request('http://gateway/webhook/stripe', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=0,v1=badsig' } })
    const res = await handleRequest(badSigReq)
    expect(res.status).toBe(202)
  })

  it('keeps inbox rate limit blocked metric single-counted on a reject', async () => {
    process.env.GATEWAY_RL_MAX = '1'
    const { reset, snapshot } = await import('../src/metrics.js')
    reset()
    const { handleRequest } = await import('../src/handler.js')
    const headers = { 'CF-Connecting-IP': '203.0.113.11', 'content-type': 'application/json' }

    const first = await handleRequest(
      new Request('http://gateway/inbox', {
        method: 'POST',
        body: '{}',
        headers,
      }),
    )
    expect(first.status).toBe(200)

    const second = await handleRequest(
      new Request('http://gateway/inbox', {
        method: 'POST',
        body: '{}',
        headers,
      }),
    )
    expect(second.status).toBe(429)
    expect(snapshot().counters.gateway_ratelimit_blocked).toBe(1)
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

  it('adds baseline security headers to handler responses', async () => {
    delete process.env.GATEWAY_SECURITY_HEADERS_ENABLE
    delete process.env.GATEWAY_SECURITY_HEADERS_CSP

    const { handleRequest } = await import('../src/handler.js')
    const res = await handleRequest(new Request('http://gateway/'))

    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-xss-protection')).toBe('0')
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  it('adds no-store cache control to integrity state responses', async () => {
    const { handleRequest } = await import('../src/handler.js')
    const res = await handleRequest(new Request('http://gateway/integrity/state'))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
