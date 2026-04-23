import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const env = {
  INBOX_TTL_DEFAULT: '60',
  INBOX_TTL_MAX: '300',
  FORGET_TOKEN: 'test-token',
  RATE_LIMIT_MAX: '2',
  RATE_LIMIT_WINDOW: '60',
  REPLAY_TTL: '600',
  SUBJECT_MAX_ENVELOPES: '5',
  PAYLOAD_MAX_BYTES: '10240',
  INBOX_HMAC_SECRET: '',
  TEST_IN_MEMORY_KV: 1,
}

async function req(path: string, init: RequestInit = {}) {
  const r = new Request(`http://localhost${path}`, init)
  return mod.fetch(r, env as any, {} as any)
}

describe('Rate limit', () => {
  it('blocks after limit', async () => {
    const common = { subject: 'rlsubj', payload: 'cipher' }
    await req('/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...common, nonce: 'n1' }) })
    await req('/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...common, nonce: 'n2' }) })
    const res = await req('/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...common, nonce: 'n3' }) })
    expect(res.status).toBe(429)
  })
})
