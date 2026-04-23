import { describe, it, expect, beforeEach, vi } from 'vitest'
import mod from '../src/index'

const baseEnv = {
  FORGET_TOKEN: 't',
  TEST_IN_MEMORY_KV: 1,
  NOTIFY_DEDUPE_TTL: '600',
  NOTIFY_RETRY_MAX: '1',
  NOTIFY_RETRY_BACKOFF_MS: '0',
  NOTIFY_BREAKER_THRESHOLD: '1',
  NOTIFY_BREAKER_COOLDOWN: '300',
  NOTIFY_WEBHOOK_ALLOWLIST: 'example.com',
}

async function req(body: any, envOverrides: Record<string, any> = {}, headers: Record<string, string> = {}) {
  const env = { ...baseEnv, ...envOverrides } as any
  const r = new Request('http://localhost/notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return mod.fetch(r, env, {} as any)
}

describe('/notify dedupe and breaker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('dedupes repeated webhook payload', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('', { status: 200 }))
    const payload = { webhookUrl: 'https://example.com/hook', data: { x: 1 } }
    const res1 = await req(payload)
    expect(res1.status).toBe(200)
    const res2 = await req(payload)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2.deduped).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not dedupe distinct webhook destinations', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('', { status: 200 }))
    const payloadA = { webhookUrl: 'https://example.com/hook-a', data: { x: 1 } }
    const payloadB = { webhookUrl: 'https://example.com/hook-b', data: { x: 1 } }
    const res1 = await req(payloadA)
    expect(res1.status).toBe(200)
    const res2 = await req(payloadB)
    expect(res2.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('opens breaker after failure and blocks subsequent calls', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch' as any)
      .mockResolvedValue(new Response('', { status: 500 }))
    const payload = { webhookUrl: 'https://example.com/fail', data: { y: 2 } }
    const breakerHeaders = { 'x-breaker-key': 'test-breaker' }
    const commonEnv = {
      NOTIFY_BREAKER_THRESHOLD: '1',
      NOTIFY_RETRY_MAX: '1',
      NOTIFY_RETRY_BACKOFF_MS: '0',
      NOTIFY_DEDUPE_TTL: '0', // disable dedupe so breaker can trigger
    }
    const res1 = await req(payload, commonEnv, breakerHeaders)
    expect(res1.status).toBe(502)
    const res2 = await req(payload, commonEnv, breakerHeaders)
    expect(res2.status).toBe(429)
    const res3 = await req(payload, { ...commonEnv, NOTIFY_BREAKER_COOLDOWN: '600' }, breakerHeaders)
    expect(res3.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries failed webhook delivery up to NOTIFY_RETRY_MAX before opening breaker', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('', { status: 500 }))
    const payload = { webhookUrl: 'https://example.com/retry', data: { y: 3 } }
    const breakerHeaders = { 'x-breaker-key': 'stripe' }
    const env = {
      NOTIFY_BREAKER_THRESHOLD: '1',
      NOTIFY_RETRY_MAX: '3',
      NOTIFY_RETRY_BACKOFF_MS: '0',
      NOTIFY_DEDUPE_TTL: '0',
    }
    const res1 = await req(payload, env, breakerHeaders)
    expect(res1.status).toBe(502)
    const res2 = await req(payload, env, breakerHeaders)
    expect(res2.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('resets breaker count after successful delivery', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    const payload = { webhookUrl: 'https://example.com/flaky', data: { y: 4 } }
    const breakerHeaders = { 'x-breaker-key': 'paypal' }
    const env = {
      NOTIFY_BREAKER_THRESHOLD: '2',
      NOTIFY_RETRY_MAX: '1',
      NOTIFY_RETRY_BACKOFF_MS: '0',
      NOTIFY_DEDUPE_TTL: '0',
    }

    const first = await req(payload, env, breakerHeaders)
    expect(first.status).toBe(502)
    const second = await req(payload, env, breakerHeaders)
    expect(second.status).toBe(200)
    const third = await req(payload, env, breakerHeaders)
    expect(third.status).toBe(502)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
