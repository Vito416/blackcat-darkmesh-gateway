import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { handleRequest } from '../src/handler'

describe('demo forward webhook -> worker notify', () => {
  it('forwards body with bearer and HMAC', async () => {
    process.env.WORKER_NOTIFY_URL = 'http://worker:8787/notify'
    process.env.WORKER_NOTIFY_TOKEN = 't-notify'
    process.env.WORKER_NOTIFY_HMAC = 'secret-hmac'
    const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })
    const req = new Request('http://gateway/webhook/demo-forward', { method: 'POST', body })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
  })
})
