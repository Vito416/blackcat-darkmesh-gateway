import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetFrontControllerCacheForTests } from '../src/frontController.js'
import { handleRequest } from '../src/handler.js'

describe('front-controller route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetFrontControllerCacheForTests()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetFrontControllerCacheForTests()
    vi.restoreAllMocks()
  })

  it('serves template html from Arweave and caches by host', async () => {
    process.env.GATEWAY_FRONT_CONTROLLER_ENABLED = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_TEMPLATE_TXID = 'tx-front-alpha'
    process.env.GATEWAY_FRONT_CONTROLLER_AR_GATEWAY_URL = 'https://arweave.net'
    process.env.GATEWAY_FRONT_CONTROLLER_CACHE_TTL_MS = '60000'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>front-alpha</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    const first = await handleRequest(new Request('https://gateway.example/front-controller/search'))
    expect(first.status).toBe(200)
    expect(first.headers.get('x-front-controller-cache')).toBe('miss')
    expect(first.headers.get('x-front-controller-template-txid')).toBe('tx-front-alpha')
    await expect(first.text()).resolves.toContain('front-alpha')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const second = await handleRequest(new Request('https://gateway.example/front-controller/search'))
    expect(second.status).toBe(200)
    expect(second.headers.get('x-front-controller-cache')).toBe('hit')
    await expect(second.text()).resolves.toContain('front-alpha')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('resolves latest tx from index url and serves it on root route', async () => {
    process.env.GATEWAY_FRONT_CONTROLLER_ENABLED = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_INDEX_URL = 'https://index.example/front-controller.json'
    process.env.GATEWAY_FRONT_CONTROLLER_AR_GATEWAY_URL = 'https://arweave.net'
    process.env.GATEWAY_FRONT_CONTROLLER_CACHE_TTL_MS = '60000'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://index.example/front-controller.json') {
        return new Response(
          JSON.stringify({
            hosts: {
              'gateway.example': { templateTxId: 'tx-front-from-index' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url === 'https://arweave.net/tx-front-from-index') {
        return new Response('<html><body>front-index</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const res = await handleRequest(new Request('https://gateway.example/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-front-controller-source')).toBe('index')
    expect(res.headers.get('x-front-controller-template-txid')).toBe('tx-front-from-index')
    await expect(res.text()).resolves.toContain('front-index')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('falls back to stale cache when refresh fetch fails', async () => {
    process.env.GATEWAY_FRONT_CONTROLLER_ENABLED = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_TEMPLATE_TXID = 'tx-front-stale'
    process.env.GATEWAY_FRONT_CONTROLLER_CACHE_TTL_MS = '1'

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(
      new Response('<html><body>front-stale</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    const first = await handleRequest(new Request('https://gateway.example/front-controller/search'))
    expect(first.status).toBe(200)
    expect(first.headers.get('x-front-controller-cache')).toBe('miss')

    await new Promise((resolve) => setTimeout(resolve, 5))
    fetchSpy.mockRejectedValueOnce(new Error('network_down'))

    const second = await handleRequest(new Request('https://gateway.example/front-controller/search?refresh=1'))
    expect(second.status).toBe(200)
    expect(second.headers.get('x-front-controller-cache')).toBe('stale')
    await expect(second.text()).resolves.toContain('front-stale')
  })

  it('fails closed when hash verification is required and hash is missing', async () => {
    process.env.GATEWAY_FRONT_CONTROLLER_ENABLED = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_TEMPLATE_TXID = 'tx-front-nohash'
    process.env.GATEWAY_FRONT_CONTROLLER_REQUIRE_HASH = '1'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>front-nohash</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    const res = await handleRequest(new Request('https://gateway.example/front-controller/search'))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({
      error: 'front_controller_template_unavailable',
      detail: 'front_controller_template_hash_required',
    })
  })

  it('fails closed when expected hash mismatches payload', async () => {
    process.env.GATEWAY_FRONT_CONTROLLER_ENABLED = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_TEMPLATE_MAP = JSON.stringify({
      'gateway.example': {
        templateTxId: 'tx-front-mismatch',
        templateSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>front-mismatch</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    const res = await handleRequest(new Request('https://gateway.example/front-controller/search'))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({
      error: 'front_controller_template_unavailable',
      detail: 'front_controller_template_hash_mismatch',
    })
  })

  it('rejects dynamic index URL when locked-release mode is enabled', async () => {
    process.env.GATEWAY_FRONT_CONTROLLER_ENABLED = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_LOCKED_RELEASE = '1'
    process.env.GATEWAY_FRONT_CONTROLLER_INDEX_URL = 'https://index.example/front-controller.json'
    process.env.GATEWAY_FRONT_CONTROLLER_TEMPLATE_TXID = 'tx-front-locked'

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await handleRequest(new Request('https://gateway.example/front-controller/search'))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: 'front_controller_locked_release_index_url_forbidden',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
