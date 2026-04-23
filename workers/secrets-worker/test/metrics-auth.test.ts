import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const env = {
  METRICS_BASIC_USER: 'u',
  METRICS_BASIC_PASS: 'p',
  METRICS_BEARER_TOKEN: 't1',
  TEST_IN_MEMORY_KV: 1,
}

async function req(headers: Record<string, string> = {}) {
  const r = new Request('http://localhost/metrics', { headers })
  return mod.fetch(r, env as any, {} as any)
}

describe('/metrics auth (worker)', () => {
  it('rejects when missing', async () => {
    const res = await req()
    expect(res.status).toBe(401)
  })

  it('accepts bearer', async () => {
    const res = await req({ authorization: 'Bearer t1', 'x-metrics-token': 't1' })
    expect(res.status).toBe(200)
  })

  it('accepts basic', async () => {
    const token = Buffer.from('u:p').toString('base64')
    const res = await req({ authorization: `Basic ${token}`, 'x-metrics-token': 't1' })
    expect(res.status).toBe(200)
  })
})
