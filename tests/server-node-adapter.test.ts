import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGatewayServer, type NodeAdapterConfig } from '../src/server.js'

interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

async function startServer(config: Partial<NodeAdapterConfig>, handler: (request: Request) => Promise<Response>) {
  const merged: NodeAdapterConfig = {
    host: '127.0.0.1',
    port: 0,
    allowedHosts: null,
    maxBodyBytes: 262_144,
    trustProxyMode: 'off',
    ...config,
  }
  const server = createGatewayServer(merged, handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  }
}

async function closeServer(server: ReturnType<typeof createGatewayServer>): Promise<void> {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve(undefined)
    })
  })
}

async function sendRaw(baseUrl: string, init: {
  path?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<RawResponse> {
  const url = new URL(init.path || '/', baseUrl)
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        method: init.method || 'GET',
        path: `${url.pathname}${url.search}`,
        headers: init.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        res.on('end', () => {
          const payload = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: payload,
          })
        })
      },
    )
    req.on('error', reject)
    if (init.body) req.write(init.body)
    req.end()
  })
}

describe('node server adapter safety controls', () => {
  const startedServers: Array<ReturnType<typeof createGatewayServer>> = []

  afterEach(async () => {
    while (startedServers.length > 0) {
      const next = startedServers.pop()
      if (next) await closeServer(next)
    }
  })

  it('returns 413 before dispatch when content-length exceeds max body limit', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }))
    const { baseUrl, server } = await startServer({ maxBodyBytes: 32 }, handler)
    startedServers.push(server)

    const payload = 'x'.repeat(64)
    const response = await sendRaw(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      body: payload,
    })

    expect(response.status).toBe(413)
    expect(response.body).toBe('payload too large')
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 413 when streamed body grows beyond max body limit', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }))
    const { baseUrl, server } = await startServer({ maxBodyBytes: 32 }, handler)
    startedServers.push(server)

    const response = await sendRaw(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'y'.repeat(64),
    })

    expect(response.status).toBe(413)
    expect(response.body).toBe('payload too large')
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores x-forwarded-host unless trusted-proxy mode is enabled', async () => {
    let observedUrl = ''
    const handler = vi.fn(async (request: Request) => {
      observedUrl = request.url
      return new Response('ok', { status: 200 })
    })

    const { baseUrl, server } = await startServer(
      {
        allowedHosts: new Set(['public.example']),
        trustProxyMode: 'off',
      },
      handler,
    )
    startedServers.push(server)

    const response = await sendRaw(baseUrl, {
      method: 'GET',
      headers: {
        host: 'public.example',
        'x-forwarded-host': 'spoofed.example',
        'x-forwarded-proto': 'https',
      },
    })

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(observedUrl).toBe('http://public.example/')
  })

  it('trusts forwarded host/proto only in forwarded trusted-proxy mode', async () => {
    let observedUrl = ''
    const handler = vi.fn(async (request: Request) => {
      observedUrl = request.url
      return new Response('ok', { status: 200 })
    })

    const { baseUrl, server } = await startServer(
      {
        allowedHosts: new Set(['public.example']),
        trustProxyMode: 'forwarded',
      },
      handler,
    )
    startedServers.push(server)

    const response = await sendRaw(baseUrl, {
      method: 'GET',
      headers: {
        host: 'proxy.internal',
        'x-forwarded-host': 'public.example',
        'x-forwarded-proto': 'https',
      },
    })

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(observedUrl).toBe('https://public.example/')
  })

  it('rejects forwarded host spoofing when trusted-proxy mode is off', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }))
    const { baseUrl, server } = await startServer(
      {
        allowedHosts: new Set(['public.example']),
        trustProxyMode: 'off',
      },
      handler,
    )
    startedServers.push(server)

    const response = await sendRaw(baseUrl, {
      method: 'GET',
      headers: {
        host: 'proxy.internal',
        'x-forwarded-host': 'public.example',
      },
    })

    expect(response.status).toBe(421)
    expect(response.body).toBe('{"error":"host_not_allowed"}')
    expect(handler).not.toHaveBeenCalled()
  })
})
