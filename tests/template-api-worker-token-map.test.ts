import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRequest } from '../src/handler.js'
import { resetTemplateContractCacheForTests } from '../src/templateContract.js'
import { reset, snapshot } from '../src/metrics.js'

describe('template api worker token map', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.GATEWAY_TEMPLATE_TOKEN = 'tmpl-secret'
    resetTemplateContractCacheForTests()
    reset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
    reset()
    vi.restoreAllMocks()
  })

  function buildWriteRequest(siteId = 'site-1') {
    return new Request('http://gateway/template/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-template-token': 'tmpl-secret' },
      body: JSON.stringify({
        action: 'checkout.create-order',
        requestId: 'req-token-map-1',
        role: 'shop_admin',
        actor: 'template-admin',
        payload: { siteId, items: [{ sku: 'sku-1', qty: 1 }] },
      }),
    })
  }

  it('fails closed when the worker token map is invalid', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = '{invalid'
    process.env.WORKER_AUTH_TOKEN = 'global-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const res = await handleRequest(buildWriteRequest())

    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toContain('worker_token_map_invalid')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(snapshot().counters.gateway_template_signer_ref_map_invalid).toBeUndefined()
  })

  it('fails closed when the worker signature ref map is invalid', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = JSON.stringify({
      'site-1': 'site-token',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP = '{invalid'
    process.env.WORKER_AUTH_TOKEN = 'global-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const res = await handleRequest(buildWriteRequest())

    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toContain('worker_signature_ref_map_invalid')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(snapshot().counters.gateway_template_signer_ref_map_invalid).toBe(1)
  })

  it('prefers the mapped site token over the global fallback token', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = JSON.stringify({
      'site-1': 'site-token',
    })
    process.env.WORKER_AUTH_TOKEN = 'global-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'https://worker-one.example/sign') {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer site-token')
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

    const res = await handleRequest(buildWriteRequest())

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(snapshot().counters.gateway_template_signer_ref_mismatch).toBeUndefined()
  })

  it('blocks write calls when the signer returns the wrong signature ref', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = JSON.stringify({
      'site-1': 'site-token',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP = JSON.stringify({
      'site-1': 'worker-site-1',
    })
    process.env.WORKER_AUTH_TOKEN = 'global-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'https://worker-one.example/sign') {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer site-token')
        return new Response(JSON.stringify({ signature: 'deadbeef', signatureRef: 'worker-ed25519' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        return new Response('unexpected', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })

    const res = await handleRequest(buildWriteRequest())

    expect(res.status).toBe(502)
    await expect(res.text()).resolves.toContain('worker_sign_signature_ref_mismatch')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(snapshot().counters.gateway_template_signer_ref_mismatch).toBe(1)
  })

  it('allows write calls when the signer returns the expected signature ref', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = JSON.stringify({
      'site-1': 'site-token',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP = JSON.stringify({
      'site-1': 'worker-ed25519',
    })
    process.env.WORKER_AUTH_TOKEN = 'global-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'https://worker-one.example/sign') {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer site-token')
        return new Response(JSON.stringify({ signature: 'deadbeef', signatureRef: 'worker-ed25519' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        const body = JSON.parse(String(init?.body))
        expect(body.signatureRef).toBe('worker-ed25519')
        expect(body.signature).toBe('deadbeef')
        return new Response('ok', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })

    const res = await handleRequest(buildWriteRequest())

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(snapshot().counters.gateway_template_signer_ref_mismatch).toBeUndefined()
  })

  it('falls back to the global token when the site is missing from the valid map', async () => {
    process.env.WRITE_API_URL = 'https://write.example'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-1': 'https://worker-one.example',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = JSON.stringify({
      'site-2': 'site-2-token',
    })
    process.env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP = JSON.stringify({
      'site-2': 'site-2-ref',
    })
    process.env.WORKER_AUTH_TOKEN = 'global-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'https://worker-one.example/sign') {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer global-token')
        return new Response(JSON.stringify({ signature: 'cafebabe', signatureRef: 'worker-ed25519' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://write.example/api/checkout/order') {
        return new Response('ok', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })

    const res = await handleRequest(buildWriteRequest())

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(snapshot().counters.gateway_template_signer_ref_map_invalid).toBeUndefined()
    expect(snapshot().counters.gateway_template_signer_ref_mismatch).toBeUndefined()
  })
})
