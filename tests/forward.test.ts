import { afterEach, describe, it, expect, vi } from 'vitest'
import { handleRequest } from '../src/handler.js'

describe('demo forward webhook -> worker notify', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.GATEWAY_DEMO_FORWARD_ENABLED
    delete process.env.GATEWAY_DEMO_FORWARD_TOKEN
    delete process.env.WORKER_NOTIFY_URL
    delete process.env.WORKER_NOTIFY_TOKEN
    delete process.env.WORKER_NOTIFY_HMAC
    delete process.env.WORKER_NOTIFY_TIMEOUT_MS
  })

  it('requires route enablement and auth token before forwarding', async () => {
    const disabledRes = await handleRequest(new Request('http://gateway/webhook/demo-forward', { method: 'POST', body: '{}' }))
    expect(disabledRes.status).toBe(404)

    process.env.GATEWAY_DEMO_FORWARD_ENABLED = '1'
    process.env.GATEWAY_DEMO_FORWARD_TOKEN = 'demo-forward-secret'
    const unauthorizedRes = await handleRequest(new Request('http://gateway/webhook/demo-forward', { method: 'POST', body: '{}' }))
    expect(unauthorizedRes.status).toBe(401)
  })

  it('forwards body with bearer and HMAC', { timeout: 15000 }, async () => {
    process.env.GATEWAY_DEMO_FORWARD_ENABLED = '1'
    process.env.GATEWAY_DEMO_FORWARD_TOKEN = 'demo-forward-secret'
    process.env.WORKER_NOTIFY_URL = 'http://worker:8787/notify'
    process.env.WORKER_NOTIFY_TOKEN = 't-notify'
    process.env.WORKER_NOTIFY_HMAC = 'secret-hmac'
    const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    try {
      let lastErr: any
      for (let i = 0; i < 5; i++) {
        try {
          const req = new Request('http://gateway/webhook/demo-forward', {
            method: 'POST',
            body,
            headers: { 'x-demo-forward-token': 'demo-forward-secret' },
          })
          const res = await handleRequest(req)
          if (res.status === 200) return
          lastErr = `status ${res.status}`
        } catch (e) {
          lastErr = e
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
      throw lastErr || new Error('forward failed')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('returns timeout when worker notify request aborts', async () => {
    process.env.GATEWAY_DEMO_FORWARD_ENABLED = '1'
    process.env.GATEWAY_DEMO_FORWARD_TOKEN = 'demo-forward-secret'
    process.env.WORKER_NOTIFY_URL = 'http://worker:8787/notify'
    process.env.WORKER_NOTIFY_TOKEN = 't-notify'
    process.env.WORKER_NOTIFY_TIMEOUT_MS = '50'
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortErr)
    try {
      const req = new Request('http://gateway/webhook/demo-forward', {
        method: 'POST',
        body: JSON.stringify({ hello: 'world' }),
        headers: { 'x-demo-forward-token': 'demo-forward-secret' },
      })
      const res = await handleRequest(req)
      expect(res.status).toBe(504)
      await expect(res.text()).resolves.toBe('notify_timeout')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
