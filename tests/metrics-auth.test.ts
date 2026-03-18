import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('/metrics auth', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns 401 when auth required but missing', async () => {
    delete process.env.METRICS_BEARER_TOKEN
    process.env.METRICS_BASIC_USER = 'u'
    process.env.METRICS_BASIC_PASS = 'p'
    const { handleRequest } = await import('../src/handler.js')
    const res = await handleRequest(new Request('http://gateway/metrics'))
    expect(res.status).toBe(401)
  })

  it('accepts bearer or basic auth', async () => {
    process.env.METRICS_BEARER_TOKEN = 't1'
    process.env.METRICS_BASIC_USER = 'u'
    process.env.METRICS_BASIC_PASS = 'p'
    const { handleRequest } = await import('../src/handler.js')
    const res = await handleRequest(new Request('http://gateway/metrics', { headers: { authorization: 'Bearer t1', 'x-metrics-token': 't1' } }))
    expect(res.status).toBe(200)
  })

  it('accepts basic auth only', async () => {
    delete process.env.METRICS_BEARER_TOKEN
    process.env.METRICS_BASIC_USER = 'u'
    process.env.METRICS_BASIC_PASS = 'p'
    const { handleRequest } = await import('../src/handler.js')
    const token = Buffer.from('u:p').toString('base64')
    const res = await handleRequest(new Request('http://gateway/metrics', { headers: { authorization: `Basic ${token}` } }))
    expect(res.status).toBe(200)
  })

  it('accepts bearer token', async () => {
    process.env.METRICS_BEARER_TOKEN = 't1'
    delete process.env.METRICS_BASIC_USER
    delete process.env.METRICS_BASIC_PASS
    const { handleRequest } = await import('../src/handler.js')
    const res = await handleRequest(new Request('http://gateway/metrics', { headers: { authorization: 'Bearer t1', 'x-metrics-token': 't1' } }))
    expect(res.status).toBe(200)
  })
})
