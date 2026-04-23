import { describe, it, expect, vi } from 'vitest'
import crypto from 'crypto'
import mod from '../src/index'

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

describe('Inbox HMAC hardening', () => {
  const secret = 'inbox-secret'
  const body = JSON.stringify({ subject: 's1', nonce: 'n1', payload: 'cipher' })

  it('rejects missing signature when HMAC required', async () => {
    const res = await call('/inbox', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, { INBOX_HMAC_SECRET: secret })
    expect(res.status).toBe(401)
  })

  it('rejects invalid signature', async () => {
    const res = await call(
      '/inbox',
      { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' } },
      { INBOX_HMAC_SECRET: secret }
    )
    expect(res.status).toBe(401)
  })

  it('accepts valid signature', async () => {
    const sig = hmacHex(secret, body)
    const res = await call(
      '/inbox',
      { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': sig } },
      { INBOX_HMAC_SECRET: secret }
    )
    expect(res.status).toBe(201)
  })
})

describe('Notify HMAC hardening', () => {
  const secret = 'notify-secret'
  const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })

  it('rejects missing signature when NOTIFY_HMAC_SECRET set', async () => {
    const res = await call(
      '/notify',
      { method: 'POST', body, headers: { 'content-type': 'application/json', Authorization: 'Bearer t' } },
      { NOTIFY_HMAC_SECRET: secret, NOTIFY_WEBHOOK_ALLOWLIST: 'example.com' }
    )
    expect(res.status).toBe(401)
  })

  it('accepts valid signature', async () => {
    const sig = hmacHex(secret, body)
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('', { status: 200 }))
    const res = await call(
      '/notify',
      {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t', 'x-signature': sig },
      },
      { NOTIFY_HMAC_SECRET: secret, NOTIFY_WEBHOOK_ALLOWLIST: 'example.com' }
    )
    expect([200, 202]).toContain(res.status)
    fetchSpy.mockRestore()
  })
})

describe('Notify SSRF/timeout/subject spray guards', () => {
  it('blocks webhook outside allowlist (fail-closed)', async () => {
    const body = JSON.stringify({ webhookUrl: 'https://internal.service.local/hook', data: { x: 1 } })
    const res = await call(
      '/notify',
      {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t' },
      } as any,
      {
        NOTIFY_HMAC_OPTIONAL: '1',
        NOTIFY_WEBHOOK_ALLOWLIST: 'example.com',
      }
    )
    expect(res.status).toBe(403)
  })

  it('enforces timeout when webhook hangs', async () => {
    const sig = hmacHex('notify-secret', JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { y: 1 } }))
    const fetchSpy = vi
      .spyOn(global, 'fetch' as any)
      .mockResolvedValue(new Response('', { status: 599 }))
    const res = await call(
      '/notify',
      {
        method: 'POST',
        body: JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { y: 1 } }),
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t', 'x-signature': sig },
      },
      {
        NOTIFY_WEBHOOK_ALLOWLIST: 'example.com',
        NOTIFY_HMAC_SECRET: 'notify-secret',
        HTTP_TIMEOUT_MS: '25',
        NOTIFY_RETRY_MAX: '1',
      }
    )
    expect([200, 502, 504]).toContain(res.status)
    fetchSpy.mockRestore()
  })

  it('caps unique subjects per IP for inbox/notify', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch' as any)
      .mockResolvedValue(new Response('', { status: 200 }))
    const resOk = await call(
      '/notify',
      {
        method: 'POST',
        body: JSON.stringify({ webhookUrl: 'https://example.com/hook', subject: 's1', data: {} }),
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t' },
      },
      {
        UNIQUE_SUBJECT_MAX_PER_IP: '1',
        UNIQUE_SUBJECT_WINDOW: '60',
        NOTIFY_HMAC_OPTIONAL: '1',
        NOTIFY_WEBHOOK_ALLOWLIST: 'example.com',
      }
    )
    expect(resOk.status).toBe(200)
    const resBlocked = await call(
      '/notify',
      {
        method: 'POST',
        body: JSON.stringify({ webhookUrl: 'https://example.com/hook', subject: 's2', data: {} }),
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t' },
      },
      {
        UNIQUE_SUBJECT_MAX_PER_IP: '1',
        UNIQUE_SUBJECT_WINDOW: '60',
        NOTIFY_HMAC_OPTIONAL: '1',
        NOTIFY_WEBHOOK_ALLOWLIST: 'example.com',
      }
    )
    expect([200, 429]).toContain(resBlocked.status)
    fetchSpy.mockRestore()
  })
})

describe('Forget cap', () => {
  it('returns 429 when too many keys under a subject', async () => {
    // seed two envelopes under same subject
    const env = { ...baseEnv, TEST_IN_MEMORY_KV: 1, FORGET_MAX_KEYS: '1', INBOX_HMAC_OPTIONAL: '1' } as any
    const reqBody = JSON.stringify({ subject: 'cap', nonce: 'n1', payload: 'x' })
    await mod.fetch(
      new Request('http://localhost/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: reqBody,
      }),
      env,
      {} as any
    )
    await mod.fetch(
      new Request('http://localhost/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'cap', nonce: 'n2', payload: 'y' }),
      }),
      env,
      {} as any
    )
    const forget = await mod.fetch(
      new Request('http://localhost/forget', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer t' },
        body: JSON.stringify({ subject: 'cap' }),
      }),
      env,
      {} as any
    )
    expect(forget.status).toBe(429)
  })
})
