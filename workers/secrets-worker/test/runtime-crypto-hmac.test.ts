import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import mod from '../src/index'
import { hexToBytes, normalizeHmacSignature } from '../src/runtime/crypto/hmac'

const baseEnv = {
  TEST_IN_MEMORY_KV: 1,
  INBOX_TTL_DEFAULT: '60',
  INBOX_TTL_MAX: '300',
  SUBJECT_MAX_ENVELOPES: '5',
  PAYLOAD_MAX_BYTES: '20480',
  RATE_LIMIT_MAX: '5',
  RATE_LIMIT_WINDOW: '60',
  REPLAY_TTL: '600',
  NOTIFY_RETRY_MAX: '1',
  NOTIFY_RETRY_BACKOFF_MS: '0',
  NOTIFY_BREAKER_THRESHOLD: '2',
  FORGET_TOKEN: 't',
}

function hmacHex(secret: string, body: string) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function call(path: string, init: RequestInit, envOverrides: Record<string, any>) {
  const env = { ...baseEnv, ...envOverrides } as any
  const req = new Request(`http://localhost${path}`, init)
  return mod.fetch(req, env, {} as any)
}

describe('runtime crypto hmac helpers', () => {
  it('normalizes signature headers before decoding', () => {
    expect(normalizeHmacSignature('  DEADBEEF  ')).toBe('deadbeef')
  })

  it('decodes normalized hex signatures', () => {
    expect(Array.from(hexToBytes(normalizeHmacSignature('  deadbeef  ')))).toEqual([222, 173, 190, 239])
  })

  it('rejects odd-length signatures', () => {
    expect(() => hexToBytes(normalizeHmacSignature('abc'))).toThrowError('invalid_signature')
  })
})

describe('runtime hmac verification boundaries', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts padded uppercase inbox signatures after normalization', async () => {
    const body = JSON.stringify({ subject: 's1', nonce: 'n1', payload: 'cipher' })
    const sig = `  ${hmacHex('inbox-secret', body).toUpperCase()}  `
    const res = await call(
      '/inbox',
      { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': sig } },
      { INBOX_HMAC_SECRET: 'inbox-secret' }
    )
    expect(res.status).toBe(201)
  })

  it('rejects malformed notify signatures with 401', async () => {
    const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('', { status: 200 }))
    const res = await call(
      '/notify',
      {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t', 'x-signature': 'abc' },
      },
      { NOTIFY_HMAC_SECRET: 'notify-secret', NOTIFY_WEBHOOK_ALLOWLIST: 'example.com' }
    )
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
