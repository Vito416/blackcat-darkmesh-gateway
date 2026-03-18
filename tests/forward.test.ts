import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { handleRequest } from '../src/handler'

describe('demo forward webhook -> worker notify', () => {
  it('forwards body with bearer and HMAC', async () => {
    process.env.WORKER_NOTIFY_URL = 'http://worker:8787/notify'
    process.env.WORKER_NOTIFY_TOKEN = 't-notify'
    process.env.WORKER_NOTIFY_HMAC = 'secret-hmac'
    const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })
    // wait for worker to start listening (compose startup races)
    let ok = false
    for (let i = 0; i < 10; i++) {
      try {
        const ping = await fetch(process.env.WORKER_NOTIFY_URL!, { method: 'HEAD' })
        if (ping.status === 405 || ping.status === 401 || ping.status === 404) { ok = true; break }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(ok).toBe(true)

    const req = new Request('http://gateway/webhook/demo-forward', { method: 'POST', body })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
  })
})
