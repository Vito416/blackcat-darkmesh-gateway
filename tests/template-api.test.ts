import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleRequest } from '../src/handler.js'
import { proxyTemplateCall } from '../src/templateApi.js'
import { resetTemplateContractCacheForTests } from '../src/templateContract.js'
import { reset, snapshot } from '../src/metrics.js'

describe('template api policy gateway', () => {
  const originalEnv = { ...process.env }
  const tempDirs: string[] = []

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
    reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
    reset()
    vi.restoreAllMocks()
  })

  async function loadHandler() {
    vi.resetModules()
    return import('../src/handler.js')
  }

  function writeContractFile(contract: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-template-contract-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'template-contract.json')
    writeFileSync(filePath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
    return filePath
  }

  it('blocks unknown template action', async () => {
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'evil.exec', payload: {} }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(403)
  })

  it('blocks template actions when contract file is missing', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_CONTRACT_FILE = '/tmp/does-not-exist-template-contract.json'
    resetTemplateContractCacheForTests()

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/' },
    })

    expect(res.status).toBe(403)
    await expect(res.text()).resolves.toContain('action_not_allowed')
  })

  it('blocks template actions when contract definition mismatches policy route', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_CONTRACT_FILE = writeContractFile({
      schemaVersion: '1.0.0',
      templateId: 'test-template',
      templateVersion: '1.0.0',
      allowedActions: [
        {
          name: 'public.resolve-route',
          method: 'POST',
          path: '/api/public/wrong-route',
          auth: { requiredRole: 'public' },
          requestSchemaRef: 'schema.request.json',
          responseSchemaRef: 'schema.response.json',
          ratelimitProfile: 'template_public_read',
          idempotency: { mode: 'optional' },
        },
      ],
      forbiddenCapabilities: ['raw-sql', 'arbitrary-outbound-http', 'eval', 'secret-access'],
    })
    resetTemplateContractCacheForTests()

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/' },
    })

    expect(res.status).toBe(403)
    await expect(res.text()).resolves.toContain('action_not_allowed')
  })

  it('requires x-template-token when configured', async () => {
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        payload: { host: 'example.com', path: '/' },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(401)
  })

  it('forwards allowed read action to AO endpoint', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        requestId: 'req-1',
        siteId: 'site-1',
        payload: { host: 'example.com', path: '/shop' },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url] = spy.mock.calls[0]
    expect(String(url)).toBe('https://ao.example/api/public/resolve-route')
  })

  it('rate limits template calls per IP before proxying', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_RL_MAX = '1'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { handleRequest: freshHandleRequest } = await loadHandler()
    const headers = {
      'content-type': 'application/json',
      'CF-Connecting-IP': '203.0.113.9',
    }

    const first = await freshHandleRequest(
      new Request('http://gateway/template/call', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'public.resolve-route',
          requestId: 'req-rl-1',
          payload: { host: 'example.com', path: '/shop' },
        }),
      }),
    )
    expect(first.status).toBe(200)

    const second = await freshHandleRequest(
      new Request('http://gateway/template/call', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'public.resolve-route',
          requestId: 'req-rl-2',
          payload: { host: 'example.com', path: '/shop' },
        }),
      }),
    )
    expect(second.status).toBe(429)
    await expect(second.text()).resolves.toBe('Too Many Requests')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(snapshot().counters.gateway_ratelimit_blocked).toBe(1)
  })

  it('rejects oversized template call bodies before upstream fetch', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_MAX_BODY_BYTES = '1'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(413)
    expect(spy).not.toHaveBeenCalled()
    expect(snapshot().counters.gateway_template_reject_size).toBe(1)
  })

  it('returns 504 when the upstream call times out', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS = '25'
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        const abort = () => {
          const err = new Error('The operation was aborted')
          ;(err as Error & { name: string }).name = 'AbortError'
          reject(err)
        }
        if (signal?.aborted) {
          abort()
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
      })
    })

    const promise = proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/shop' },
    })

    await vi.advanceTimersByTimeAsync(25)
    const res = await promise

    expect(res.status).toBe(504)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0][1] as RequestInit | undefined)?.signal).toBeDefined()
    expect(snapshot().counters.gateway_template_upstream_timeout).toBe(1)
  })

  it('blocks upstream hosts not on the allowlist and allows configured hosts', async () => {
    process.env.GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST = 'allowed.example'

    process.env.AO_PUBLIC_API_URL = 'https://blocked.example'
    const blockedSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const blocked = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(blocked.status).toBe(403)
    expect(blockedSpy).not.toHaveBeenCalled()
    expect(snapshot().counters.gateway_template_target_blocked).toBe(1)

    vi.restoreAllMocks()
    process.env.AO_PUBLIC_API_URL = 'https://allowed.example'
    const allowedSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const allowed = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(allowed.status).toBe(200)
    expect(allowedSpy).toHaveBeenCalledTimes(1)
    const [url] = allowedSpy.mock.calls[0]
    expect(String(url)).toBe('https://allowed.example/api/public/resolve-route')
  })

  it('blocks write actions unless explicitly enabled', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(403)
  })

  it('allows write action when enabled and payload is valid', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url] = spy.mock.calls[0]
    expect(String(url)).toBe('https://write.example/api/checkout/order')
  })

  it('rejects invalid payload shape', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'public.resolve-route',
        payload: { host: 'example.com' },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(400)
  })
})
