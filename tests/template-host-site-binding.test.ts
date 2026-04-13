import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleRequest } from '../src/handler.js'

describe('template host->site binding', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.GATEWAY_SITE_ID_BY_HOST_MAP
    delete process.env.AO_PUBLIC_API_URL
  })

  it('blocks host not present in host map', async () => {
    process.env.GATEWAY_SITE_ID_BY_HOST_MAP = JSON.stringify({
      'allowed.example': 'site-allowed',
    })

    const res = await handleRequest(
      new Request('https://unknown.example/template/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'public.resolve-route',
          payload: { path: '/' },
        }),
      }),
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'site_host_not_allowed' })
  })

  it('blocks siteId mismatch when host map is enabled', async () => {
    process.env.GATEWAY_SITE_ID_BY_HOST_MAP = JSON.stringify({
      'gateway.example': 'site-a',
    })

    const res = await handleRequest(
      new Request('https://gateway.example/template/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'public.resolve-route',
          siteId: 'site-b',
          payload: { siteId: 'site-b', path: '/' },
        }),
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'site_id_host_mismatch' })
  })

  it('injects mapped siteId when request body does not provide one', async () => {
    process.env.GATEWAY_SITE_ID_BY_HOST_MAP = JSON.stringify({
      'gateway.example': 'site-a',
    })
    process.env.AO_PUBLIC_API_URL = 'https://ao.example'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'OK', route: { pageId: 'home' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await handleRequest(
      new Request('https://gateway.example/template/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'public.resolve-route',
          payload: { path: '/' },
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const sent = JSON.parse(String(init.body || '{}'))
    expect(sent.siteId).toBe('site-a')
  })
})
