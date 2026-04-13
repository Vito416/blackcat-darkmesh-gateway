import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { handleRequest } from './handler.js'

const host = process.env.HOST || '127.0.0.1'
const port = readPort(process.env.PORT, 8080)
const allowedHosts = parseAllowedHosts(process.env.GATEWAY_ALLOWED_HOSTS)

function readPort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return fallback
  return parsed
}

function parseAllowedHosts(raw: string | undefined): Set<string> | null {
  if (!raw) return null
  const hosts = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  if (hosts.length === 0) return null
  return new Set(hosts)
}

function normalizeHost(input: string): string {
  return input.trim().toLowerCase().replace(/:\d+$/, '')
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (!value) return ''
  if (Array.isArray(value)) return value[0] || ''
  return value
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, raw] of Object.entries(req.headers)) {
    if (typeof raw === 'undefined') continue
    if (Array.isArray(raw)) {
      for (const item of raw) headers.append(key, item)
      continue
    }
    headers.set(key, raw)
  }
  return headers
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return undefined
  const merged = Buffer.concat(chunks)
  return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength)
}

function requestUrl(req: IncomingMessage): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']).split(',')[0]?.trim()
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']).split(',')[0]?.trim()
  const directHost = firstHeaderValue(req.headers.host).trim()
  const scheme = forwardedProto || 'http'
  const authority = forwardedHost || directHost || `${host}:${port}`
  const path = req.url || '/'
  return `${scheme}://${authority}${path}`
}

function isHostAllowed(req: IncomingMessage): boolean {
  if (!allowedHosts) return true
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']).split(',')[0]?.trim()
  const directHost = firstHeaderValue(req.headers.host).trim()
  const candidate = normalizeHost(forwardedHost || directHost)
  if (!candidate) return false
  return allowedHosts.has(candidate)
}

async function sendResponse(nodeRes: ServerResponse, response: Response): Promise<void> {
  nodeRes.statusCode = response.status
  nodeRes.statusMessage = response.statusText || nodeRes.statusMessage

  const setCookieGetter = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
  if (typeof setCookieGetter === 'function') {
    const cookies = setCookieGetter.call(response.headers)
    if (cookies.length > 0) nodeRes.setHeader('set-cookie', cookies)
  }

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue
    nodeRes.setHeader(key, value)
  }

  if (!response.body) {
    nodeRes.end()
    return
  }

  await pipeline(Readable.fromWeb(response.body as unknown as ReadableStream), nodeRes)
}

async function handleNodeRequest(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
  if (!isHostAllowed(nodeReq)) {
    nodeRes.statusCode = 421
    nodeRes.setHeader('content-type', 'application/json')
    nodeRes.end(JSON.stringify({ error: 'host_not_allowed' }))
    return
  }

  const controller = new AbortController()
  nodeReq.on('aborted', () => controller.abort())

  try {
    const body = await readBody(nodeReq)
    const requestBody =
      typeof body === 'undefined'
        ? undefined
        : (() => {
            const copy = new Uint8Array(body.byteLength)
            copy.set(body)
            return copy
          })()
    const webRequest = new Request(requestUrl(nodeReq), {
      method: nodeReq.method || 'GET',
      headers: toHeaders(nodeReq),
      body: requestBody,
      signal: controller.signal,
    })
    const response = await handleRequest(webRequest)
    await sendResponse(nodeRes, response)
  } catch (error) {
    if (controller.signal.aborted) {
      nodeRes.statusCode = 499
      nodeRes.end()
      return
    }
    console.error('[gateway] request failed', error)
    nodeRes.statusCode = 500
    nodeRes.setHeader('content-type', 'application/json')
    nodeRes.end(JSON.stringify({ error: 'internal_error' }))
  }
}

const server = createServer((req, res) => {
  handleNodeRequest(req, res).catch((error) => {
    console.error('[gateway] fatal request error', error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'internal_error' }))
      return
    }
    res.end()
  })
})

server.listen(port, host, () => {
  console.log(`[gateway] listening on http://${host}:${port}`)
})
