import { beforeEach, describe, expect, it, vi } from 'vitest'

const aoClient = {
  message: vi.fn(),
  result: vi.fn(),
}

const connect = vi.fn(() => aoClient)
const createDataItemSigner = vi.fn(() => async () => ({ signature: new Uint8Array(64), address: 'addr-test' }))

vi.mock('@permaweb/aoconnect', () => ({
  default: {
    connect,
    createDataItemSigner,
  },
  connect,
  createDataItemSigner,
}))

import mod from '../src/index'

const baseEnv = {
  TEST_IN_MEMORY_KV: 1,
  AO_HB_URL: 'https://push.forward.computer',
  AO_HB_SCHEDULER: 'n_XZJhUnmldNFo4dhajoPZWhBXuJk-OcQr5JQ49c4Zo',
  AO_REGISTRY_PROCESS_ID: 'REGISTRY_PID_1',
  AO_WALLET_JSON: '{}',
}

async function callPath(
  path: string,
  body: Record<string, unknown>,
  envOverrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  return mod.fetch(req, { ...baseEnv, ...envOverrides } as any, {} as any)
}

async function callSiteByHost(
  body: Record<string, unknown>,
  envOverrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return callPath('/api/public/site-by-host', body, envOverrides, headers)
}

describe('/api/public/site-by-host', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (aoClient as any).dryrun
    aoClient.message.mockReset()
    aoClient.result.mockReset()
  })

  it('returns normalized site metadata on registry hit', async () => {
    aoClient.message.mockResolvedValueOnce('msg-1')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: JSON.stringify({
          status: 'OK',
          data: { siteId: 'site-alpha', activeVersion: 'v1' },
        }),
      },
    })

    const res = await callSiteByHost(
      { host: 'Shop.EXAMPLE.com', requestId: 'req-site-host-1' },
      {},
      { 'x-trace-id': 'trace-id-1234' },
    )
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json).toEqual({
      status: 'OK',
      data: { siteId: 'site-alpha', activeVersion: 'v1' },
      source: 'registry',
    })

    expect(aoClient.message).toHaveBeenCalledTimes(1)
    const payload = aoClient.message.mock.calls[0][0]
    expect(payload.process).toBe('REGISTRY_PID_1')
    expect(payload.data).toBe(
      JSON.stringify({
        Action: 'GetSiteByHost',
        'Request-Id': 'req-site-host-1',
        Host: 'shop.example.com',
      }),
    )
    expect(payload.tags).toEqual(expect.arrayContaining([{ name: 'Action', value: 'GetSiteByHost' }]))
    expect(payload.tags).toEqual(expect.arrayContaining([{ name: 'Host', value: 'shop.example.com' }]))
  })

  it('passes through runtime pointers from registry output', async () => {
    aoClient.message.mockResolvedValueOnce('msg-runtime')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: JSON.stringify({
          status: 'OK',
          data: {
            siteId: 'site-runtime',
            activeVersion: 'v2',
            runtime: {
              processId: 'SITE_PID_RUNTIME',
              moduleId: 'SITE_MODULE_RUNTIME',
              scheduler: 'SITE_SCHED_RUNTIME',
              workerUrl: 'https://worker.example.net/runtime',
            },
            runtimePointers: {
              catalogProcessId: 'CAT_PID_RUNTIME',
            },
            readProcessId: 'READ_PID_RUNTIME',
            ingest_process_id: 'INGEST_PID_RUNTIME',
            worker_id: 'WORKER_PID_RUNTIME',
            updated_at: '2026-04-15T00:00:00Z',
          },
        }),
      },
    })

    const res = await callSiteByHost({ host: 'runtime.example.com' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      status: 'OK',
      data: {
        siteId: 'site-runtime',
        activeVersion: 'v2',
        runtime: {
          processId: 'SITE_PID_RUNTIME',
          moduleId: 'SITE_MODULE_RUNTIME',
          scheduler: 'SITE_SCHED_RUNTIME',
          workerUrl: 'https://worker.example.net/runtime',
        },
        runtimePointers: {
          catalogProcessId: 'CAT_PID_RUNTIME',
          readProcessId: 'READ_PID_RUNTIME',
          ingest_process_id: 'INGEST_PID_RUNTIME',
          worker_id: 'WORKER_PID_RUNTIME',
          updated_at: '2026-04-15T00:00:00Z',
        },
      },
      source: 'registry',
    })
  })

  it('maps NOT_FOUND to 404', async () => {
    aoClient.message.mockResolvedValueOnce('msg-2')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: JSON.stringify({
          status: 'ERROR',
          code: 'NOT_FOUND',
          message: 'Domain not bound',
        }),
      },
    })

    const res = await callSiteByHost({ host: 'missing.example.com' })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toMatchObject({ status: 'ERROR', code: 'NOT_FOUND' })
  })

  it('maps shell output without status envelope to 502', async () => {
    aoClient.message.mockResolvedValueOnce('msg-shell')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: {
          'ao-types': 'print=\"atom\"',
          data: 'New Message From Zqk... Action = GetSiteByHost',
          prompt: 'blackcat-ao-registry@aos-2.0.4>',
        },
      },
    })

    const res = await callSiteByHost({ host: 'shop.example.com' })
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json).toMatchObject({
      status: 'ERROR',
      code: 'INVALID_UPSTREAM_RESPONSE',
      message: 'registry_shell_output_without_envelope',
    })
  })

  it('maps empty output to 404 not_found_or_empty_result', async () => {
    aoClient.message.mockResolvedValueOnce('msg-empty')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: '',
        Error: {},
      },
    })

    const res = await callSiteByHost({ host: 'unknown.example.com' })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toMatchObject({
      status: 'ERROR',
      code: 'NOT_FOUND',
      message: 'not_found_or_empty_result',
    })
  })

  it('maps ao-types empty output atom to 404 not_found_or_empty_result', async () => {
    aoClient.message.mockResolvedValueOnce('msg-empty-atom')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: {
          'ao-types': 'print=\"atom\"',
          data: '',
          prompt: '',
        },
      },
    })

    const res = await callSiteByHost({ host: 'unknown.example.com' })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toMatchObject({
      status: 'ERROR',
      code: 'NOT_FOUND',
      message: 'not_found_or_empty_result',
    })
  })

  it('rejects invalid input with 400', async () => {
    const res = await callSiteByHost({ host: 'https://bad.example.com' })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('invalid_host')
  })

  it('maps upstream transport failure to 502', async () => {
    aoClient.message.mockRejectedValueOnce(new Error('upstream_down'))

    const res = await callSiteByHost({ host: 'shop.example.com' })
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json).toMatchObject({ status: 'ERROR', code: 'UPSTREAM_FAILURE' })
    expect(String(json.message)).toContain('upstream_down')
  })

  it('resolves read site process from registry runtime pointers when AO site pid is not configured', async () => {
    aoClient.message.mockResolvedValueOnce('msg-site-runtime').mockResolvedValueOnce('msg-read')
    aoClient.result
      .mockResolvedValueOnce({
        raw: {
          Output: JSON.stringify({
            status: 'OK',
            data: {
              siteId: 'site-alpha',
              runtime: {
                processId: 'SITE_PID_ROUTER',
                siteProcessId: 'SITE_PID_DYNAMIC',
              },
            },
          }),
        },
      })
      .mockResolvedValueOnce({
        raw: {
          Output: JSON.stringify({
            status: 'OK',
            data: { route: { pageId: 'home' } },
          }),
        },
      })

    const res = await callPath(
      '/api/public/resolve-route',
      {
        siteId: 'site-alpha',
        payload: { siteId: 'site-alpha', path: '/' },
      },
      {
        GATEWAY_TEMPLATE_TOKEN_MAP: JSON.stringify({ 'site-alpha': 'tok-alpha' }),
      },
      {
        authorization: 'Bearer tok-alpha',
      },
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      status: 'OK',
      data: { route: { pageId: 'home' } },
    })

    expect(aoClient.message).toHaveBeenCalledTimes(2)
    const runtimeLookup = aoClient.message.mock.calls[0][0]
    expect(runtimeLookup.process).toBe('REGISTRY_PID_1')
    expect(runtimeLookup.tags).toEqual(expect.arrayContaining([{ name: 'Action', value: 'GetSiteRuntime' }]))
    expect(JSON.parse(String(runtimeLookup.data))).toMatchObject({
      Action: 'GetSiteRuntime',
      'Site-Id': 'site-alpha',
    })

    const readLookup = aoClient.message.mock.calls[1][0]
    expect(readLookup.process).toBe('SITE_PID_DYNAMIC')
    expect(readLookup.tags).toEqual(expect.arrayContaining([{ name: 'Action', value: 'ResolveRoute' }]))
  })

  it('falls back to message/result when dryrun is available but fails', async () => {
    ;(aoClient as any).dryrun = vi.fn().mockRejectedValue(new Error('Error running dryrun'))
    aoClient.message.mockResolvedValueOnce('msg-site-runtime').mockResolvedValueOnce('msg-read')
    aoClient.result
      .mockResolvedValueOnce({
        raw: {
          Output: JSON.stringify({
            status: 'OK',
            data: {
              siteId: 'site-alpha',
              runtime: {
                siteProcessId: 'SITE_PID_DYNAMIC',
              },
            },
          }),
        },
      })
      .mockResolvedValueOnce({
        raw: {
          Output: JSON.stringify({
            status: 'OK',
            data: { route: { pageId: 'home' } },
          }),
        },
      })

    const res = await callPath(
      '/api/public/resolve-route',
      {
        siteId: 'site-alpha',
        payload: { siteId: 'site-alpha', path: '/' },
      },
      {
        GATEWAY_TEMPLATE_TOKEN_MAP: JSON.stringify({ 'site-alpha': 'tok-alpha' }),
      },
      {
        authorization: 'Bearer tok-alpha',
      },
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      status: 'OK',
      data: { route: { pageId: 'home' } },
    })
    expect((aoClient as any).dryrun).toHaveBeenCalledTimes(2)
    expect(aoClient.message).toHaveBeenCalledTimes(2)
    expect(aoClient.result).toHaveBeenCalledTimes(2)
  })

  it('maps read timeout failures to 504 for resolve-route', async () => {
    aoClient.message.mockResolvedValueOnce('msg-site-runtime').mockRejectedValueOnce(new Error('timeout_ao_read_signed_message_30000ms'))
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: JSON.stringify({
          status: 'OK',
          data: {
            siteId: 'site-alpha',
            runtime: {
              siteProcessId: 'SITE_PID_DYNAMIC',
            },
          },
        }),
      },
    })

    const res = await callPath(
      '/api/public/resolve-route',
      {
        siteId: 'site-alpha',
        payload: { siteId: 'site-alpha', path: '/' },
      },
      {
        GATEWAY_TEMPLATE_TOKEN_MAP: JSON.stringify({ 'site-alpha': 'tok-alpha' }),
      },
      {
        authorization: 'Bearer tok-alpha',
      },
    )

    expect(res.status).toBe(504)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'ao_read_timeout',
    })
  })

  it('rejects conflicting runtime process aliases in registry runtime payload', async () => {
    aoClient.message.mockResolvedValueOnce('msg-site-runtime')
    aoClient.result.mockResolvedValueOnce({
      raw: {
        Output: JSON.stringify({
          status: 'OK',
          data: {
            siteId: 'site-conflict',
            runtime: {
              siteProcessId: 'SITE_PID_ONE',
              readPid: 'SITE_PID_TWO',
            },
          },
        }),
      },
    })

    const res = await callPath(
      '/api/public/resolve-route',
      {
        siteId: 'site-conflict',
        payload: { siteId: 'site-conflict', path: '/' },
      },
      {
        GATEWAY_TEMPLATE_TOKEN_MAP: JSON.stringify({ 'site-conflict': 'tok-conflict' }),
      },
      {
        authorization: 'Bearer tok-conflict',
      },
    )

    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toContain('missing_ao_site_process_id')
  })
})
