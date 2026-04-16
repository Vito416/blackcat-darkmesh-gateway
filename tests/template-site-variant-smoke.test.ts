import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleRequest } from '../src/handler.js'
import { resetTemplateContractCacheForTests } from '../src/templateContract.js'

describe('template site-variant smoke path', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
    vi.restoreAllMocks()
  })

  it('threads site -> variant map -> templateTxId into /template/call', async () => {
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'
    process.env.GATEWAY_TEMPLATE_VARIANT_MAP = JSON.stringify({
      'site-alpha': {
        variant: 'signal',
        templateTxId: 'tx-alpha',
        manifestTxId: 'manifest-alpha',
      },
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'OK', payload: { siteId: 'site-alpha', path: '/' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const configRes = await handleRequest(new Request('https://gateway.example/template/config'))
    expect(configRes.status).toBe(200)
    const configBody = await configRes.json()
    expect(configBody.upstream.variantMapConfigured).toBe(true)

    const callRes = await handleRequest(
      new Request('https://gateway.example/template/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'public.resolve-route',
          siteId: 'site-alpha',
          payload: { siteId: 'site-alpha', path: '/' },
        }),
      }),
    )

    expect(callRes.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('https://ao.example/api/public/resolve-route')

    const body = JSON.parse(String(init.body))
    expect(body.siteId).toBe('site-alpha')
    expect(body.payload).toMatchObject({
      path: '/',
      templateVariant: {
        variant: 'signal',
        templateTxId: 'tx-alpha',
        manifestTxId: 'manifest-alpha',
      },
    })
  })
})
