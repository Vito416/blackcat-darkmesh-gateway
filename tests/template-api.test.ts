import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleRequest } from '../src/handler.js'
import { getTemplateActionPolicy } from '../src/runtime/template/actions.js'
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

  it('keeps the template action catalog aligned with known read/write actions', () => {
    expect(getTemplateActionPolicy('public.get-page')?.kind).toBe('read')
    expect(getTemplateActionPolicy('checkout.create-order')?.kind).toBe('write')
    expect(getTemplateActionPolicy('checkout.create-order')?.target).toBe('write')
    expect(getTemplateActionPolicy('evil.exec')).toBeUndefined()
  })

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

  it('propagates trace ids through template upstream calls and response headers', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await handleRequest(
      new Request('http://gateway/template/call', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': 'trace-abc-123',
        },
        body: JSON.stringify({
          action: 'public.resolve-route',
          requestId: 'req-trace-1',
          siteId: 'site-1',
          payload: { host: 'example.com', path: '/shop' },
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('x-trace-id')).toBe('trace-abc-123')
    expect(spy).toHaveBeenCalledTimes(1)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('x-trace-id')).toBe('trace-abc-123')
  })

  it('generates a trace id when one is missing on direct template calls', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const randomUuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('trace-generated-1')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-trace-id')).toBe('trace-generated-1')
    expect(randomUuidSpy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(1)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('x-trace-id')).toBe('trace-generated-1')
  })

  it('forwards upstream bearer auth header when configured', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_UPSTREAM_AUTH_MODE = 'bearer'
    process.env.GATEWAY_TEMPLATE_UPSTREAM_TOKEN = 'upstream-secret'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      siteId: 'site-1',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const init = spy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer upstream-secret')
  })

  it('fails closed when upstream auth mode requires a missing token', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_UPSTREAM_AUTH_MODE = 'bearer'

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      siteId: 'site-1',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
    await expect(res.text()).resolves.toContain('template_upstream_auth_not_configured')
  })

  it('injects template variant metadata when the site mapping exists', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_VARIANT_MAP = JSON.stringify({
      'site-1': {
        variant: ' signal ',
        templateTxId: ' tx-alpha ',
        manifestTxId: ' manifest-alpha ',
      },
    })

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      siteId: 'site-1',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const init = spy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.payload.templateVariant).toEqual({
      variant: 'signal',
      templateTxId: 'tx-alpha',
      manifestTxId: 'manifest-alpha',
    })
  })

  it('does not inject template variant metadata when the site has no map entry', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_VARIANT_MAP = JSON.stringify({
      'site-2': {
        variant: 'signal',
        templateTxId: 'tx-alpha',
        manifestTxId: 'manifest-alpha',
      },
    })

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      siteId: 'site-1',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const init = spy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.payload).not.toHaveProperty('templateVariant')
  })

  it('fails closed when template variant map config is malformed', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_VARIANT_MAP = JSON.stringify({
      'site-1': {
        variant: 'signal',
        templateTxId: 'tx-alpha',
      },
    })

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      siteId: 'site-1',
      payload: { host: 'example.com', path: '/shop' },
    })

    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toContain('template_variant_map_invalid')
    expect(spy).not.toHaveBeenCalled()
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

  it('rejects secret-smuggling fields in template payloads before upstream fetch', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await proxyTemplateCall({
      action: 'public.resolve-route',
      payload: {
        host: 'example.com',
        path: '/shop',
        customer: {
          profile: {
            apiKey: 'secret-value',
          },
        },
      },
    })

    expect(res.status).toBe(400)
    await expect(res.text()).resolves.toContain('payload_contains_forbidden_secret_fields')
    expect(spy).not.toHaveBeenCalled()
    expect(snapshot().counters.gateway_template_secret_guard_blocked).toBe(1)
  })

  it('blocks write actions unless explicitly enabled', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-write-disabled-1',
        role: 'shop_admin',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(403)
  })

  it('allows write action when enabled and payload is valid', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.WORKER_API_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://worker.example/sign') {
        return new Response(JSON.stringify({ signature: 'deadbeef', signatureRef: 'worker-ed25519' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        return new Response('ok', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })
    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-write-ok-1',
        role: 'shop_admin',
        actor: 'template-admin',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(String(spy.mock.calls[0][0])).toBe('https://worker.example/sign')
    expect(String(spy.mock.calls[1][0])).toBe('https://write.example/api/checkout/order')

    const writeBody = JSON.parse(String((spy.mock.calls[1][1] as RequestInit).body))
    expect(writeBody.action).toBe('CreateOrder')
    expect(writeBody.signature).toBe('deadbeef')
    expect(writeBody.signatureRef).toBe('worker-ed25519')
    expect(writeBody.templateAction).toBe('checkout.create-order')
    expect(snapshot().counters.gateway_template_secret_guard_blocked).toBeUndefined()
  })

  it('enforces contract role for write actions even when caller role is omitted', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.WORKER_API_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://worker.example/sign') {
        return new Response(JSON.stringify({ signature: 'deadbeef', signatureRef: 'worker-ed25519' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        return new Response('ok', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-write-no-role-1',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
    const writeBody = JSON.parse(String((spy.mock.calls[1][1] as RequestInit).body))
    expect(writeBody.role).toBe('shop_admin')
  })

  it('requires request id for write actions with required idempotency', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        role: 'shop_admin',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(400)
    await expect(res.text()).resolves.toContain('missing_request_id')
    expect(spy).not.toHaveBeenCalled()
  })

  it('routes write signer calls using per-site worker map', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
      'site-2': 'https://worker-two.example',
    })
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://worker-two.example/sign') {
        return new Response(JSON.stringify({ signature: 'cafebabe', signatureRef: 'worker-site-2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        return new Response('ok', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-worker-map-1',
        role: 'shop_admin',
        payload: { siteId: 'site-2', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(String(spy.mock.calls[0][0])).toBe('https://worker-two.example/sign')
    expect(String(spy.mock.calls[1][0])).toBe('https://write.example/api/checkout/order')
  })

  it('prefers runtime routing hints for signer url and write pid override header', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-map.example',
    })
    process.env.WORKER_AUTH_TOKEN = 'worker-token'

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'https://worker-runtime.example/sign') {
        return new Response(JSON.stringify({ signature: 'feedface', signatureRef: 'worker-site-runtime' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        const headers = new Headers(init?.headers)
        expect(headers.get('x-write-process-id')).toBe('B'.repeat(43))
        return new Response('ok', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })

    const res = await proxyTemplateCall({
      action: 'checkout.create-order',
      requestId: 'req-runtime-routing-1',
      role: 'shop_admin',
      siteId: 'site-1',
      payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      runtimeHints: {
        runtime: {
          workerUrl: 'https://worker-runtime.example',
          writeProcessId: 'B'.repeat(43),
        },
      },
    })

    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(String(spy.mock.calls[0][0])).toBe('https://worker-runtime.example/sign')
    expect(String(spy.mock.calls[1][0])).toBe('https://write.example/api/checkout/order')
  })

  it('fails closed when runtime write pid hint is invalid', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.WORKER_API_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const res = await proxyTemplateCall({
      action: 'checkout.create-order',
      requestId: 'req-runtime-routing-bad-1',
      role: 'shop_admin',
      siteId: 'site-1',
      payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      runtimeHints: {
        runtimePointers: {
          writeProcessId: 'bad pid with spaces',
        },
      },
    })

    expect(res.status).toBe(502)
    await expect(res.text()).resolves.toContain('invalid_runtime_write_process_id')
    expect(spy).not.toHaveBeenCalled()
  })

  it('fails closed when worker map is configured but site route is missing', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-worker-map-missing-1',
        role: 'shop_admin',
        payload: { siteId: 'site-2', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(503)
    await expect(res.text()).resolves.toContain('worker_target_not_configured')
    expect(spy).not.toHaveBeenCalled()
  })

  it('fails closed when worker map config is invalid JSON', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = '{invalid'
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-worker-map-invalid-1',
        role: 'shop_admin',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toContain('worker_route_map_invalid')
    expect(spy).not.toHaveBeenCalled()
  })

  it('requires explicit template auth config for write actions when mutations are enabled', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    delete process.env.GATEWAY_TEMPLATE_TOKEN
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-write-no-template-auth-config',
        role: 'shop_admin',
        payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toContain('template_auth_not_configured')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects write calls when top-level siteId and payload.siteId differ', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.WORKER_API_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'worker-token'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const req = new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-site-mismatch-1',
        siteId: 'site-1',
        role: 'shop_admin',
        payload: { siteId: 'site-2', items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })

    const res = await handleRequest(req)
    expect(res.status).toBe(400)
    await expect(res.text()).resolves.toContain('site_id_mismatch')
    expect(spy).not.toHaveBeenCalled()
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
