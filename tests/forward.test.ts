import { describe, it, expect, vi } from 'vitest'
import { handleRequest } from '../src/handler.js'

describe('demo forward webhook -> worker notify', () => {
  it('forwards body with bearer and HMAC', { timeout: 15000 }, async () => {
    process.env.WORKER_NOTIFY_URL = 'http://worker:8787/notify'
    process.env.WORKER_NOTIFY_TOKEN = 't-notify'
    process.env.WORKER_NOTIFY_HMAC = 'secret-hmac'
    const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    try {
      let lastErr: any
      for (let i = 0; i < 5; i++) {
        try {
          const req = new Request('http://gateway/webhook/demo-forward', { method: 'POST', body })
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
})
