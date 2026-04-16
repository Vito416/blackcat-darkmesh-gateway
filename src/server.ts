import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { handleRequest } from './handler.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8080
const DEFAULT_NODE_MAX_BODY_BYTES = 262_144

type TrustProxyMode = 'off' | 'forwarded'

type RequestHandler = (request: Request) => Response | Promise<Response>

export interface NodeAdapterConfig {
  host: string
  port: number
  allowedHosts: Set<string> | null
  maxBodyBytes: number
  trustProxyMode: TrustProxyMode
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('payload too large')
    this.name = 'PayloadTooLargeError'
  }
}

function readPort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) return fallback
  return parsed
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

function parseAllowedHosts(raw: string | undefined): Set<string> | null {
  if (!raw) return null
  const hosts = raw
    .split(',')
    .map((value) => normalizeHost(value))
    .filter(Boolean)
  if (hosts.length === 0) return null
  return new Set(hosts)
}

function parseTrustProxyMode(raw: string | undefined): TrustProxyMode {
  const value = (raw || 'off').trim().toLowerCase()
  if (value === 'forwarded' || value === '1' || value === 'true' || value === 'on') return 'forwarded'
  return 'off'
}

function normalizeHost(input: string): string {
  return input.trim().toLowerCase().replace(/:\d+$/, '')
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (!value) return ''
  if (Array.isArray(value)) return value[0] || ''
  return value
}

function forwardedHeaderValue(value: string | string[] | undefined): string {
  return firstHeaderValue(value)
    .split(',')[0]
    ?.trim() || ''
}

function trustForwardedHeaders(config: NodeAdapterConfig): boolean {
  return config.trustProxyMode === 'forwarded'
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

async function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined

  const rawContentLength = firstHeaderValue(req.headers['content-length']).trim()
  if (rawContentLength) {
    const contentLength = Number.parseInt(rawContentLength, 10)
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw new PayloadTooLargeError()
    }
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += piece.byteLength
    if (totalBytes > maxBodyBytes) {
      req.pause()
      throw new PayloadTooLargeError()
    }
    chunks.push(piece)
  }

  if (chunks.length === 0) return undefined
  const merged = Buffer.concat(chunks)
  return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength)
}

function requestUrl(req: IncomingMessage, config: NodeAdapterConfig): string {
  const forwardedProto = trustForwardedHeaders(config) ? forwardedHeaderValue(req.headers['x-forwarded-proto']) : ''
  const forwardedHost = trustForwardedHeaders(config) ? forwardedHeaderValue(req.headers['x-forwarded-host']) : ''
  const directHost = firstHeaderValue(req.headers.host).trim()
  const scheme = forwardedProto || 'http'
  const authority = forwardedHost || directHost || `${config.host}:${config.port}`
  const path = req.url || '/'
  return `${scheme}://${authority}${path}`
}

function isHostAllowed(req: IncomingMessage, config: NodeAdapterConfig): boolean {
  if (!config.allowedHosts) return true

  const forwardedHost = trustForwardedHeaders(config) ? forwardedHeaderValue(req.headers['x-forwarded-host']) : ''
  const directHost = firstHeaderValue(req.headers.host).trim()
  const candidate = normalizeHost(forwardedHost || directHost)

  if (!candidate) return false
  return config.allowedHosts.has(candidate)
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

async function handleNodeRequest(
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
  config: NodeAdapterConfig,
  requestHandler: RequestHandler,
): Promise<void> {
  if (!isHostAllowed(nodeReq, config)) {
    nodeRes.statusCode = 421
    nodeRes.setHeader('content-type', 'application/json')
    nodeRes.end(JSON.stringify({ error: 'host_not_allowed' }))
    return
  }

  const controller = new AbortController()
  nodeReq.on('aborted', () => controller.abort())

  try {
    const body = await readBody(nodeReq, config.maxBodyBytes)
    const requestBody =
      typeof body === 'undefined'
        ? undefined
        : (() => {
            const copy = new Uint8Array(body.byteLength)
            copy.set(body)
            return copy
          })()

    const webRequest = new Request(requestUrl(nodeReq, config), {
      method: nodeReq.method || 'GET',
      headers: toHeaders(nodeReq),
      body: requestBody,
      signal: controller.signal,
    })
    const response = await requestHandler(webRequest)
    await sendResponse(nodeRes, response)
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      nodeRes.statusCode = 413
      nodeRes.setHeader('content-type', 'text/plain; charset=utf-8')
      nodeRes.end('payload too large')
      return
    }
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

export function readNodeAdapterConfig(env: NodeJS.ProcessEnv = process.env): NodeAdapterConfig {
  return {
    host: env.HOST || DEFAULT_HOST,
    port: readPort(env.PORT, DEFAULT_PORT),
    allowedHosts: parseAllowedHosts(env.GATEWAY_ALLOWED_HOSTS),
    maxBodyBytes: readPositiveInt(env.GATEWAY_NODE_MAX_BODY_BYTES, DEFAULT_NODE_MAX_BODY_BYTES),
    trustProxyMode: parseTrustProxyMode(env.GATEWAY_TRUST_PROXY_MODE),
  }
}

export function createGatewayServer(
  config: NodeAdapterConfig = readNodeAdapterConfig(),
  requestHandler: RequestHandler = handleRequest,
) {
  return createServer((req, res) => {
    handleNodeRequest(req, res, config, requestHandler).catch((error) => {
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
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false
  return fileURLToPath(import.meta.url) === process.argv[1]
}

if (isMainModule()) {
  const config = readNodeAdapterConfig(process.env)
  const server = createGatewayServer(config, handleRequest)
  server.listen(config.port, config.host, () => {
    console.log(`[gateway] listening on http://${config.host}:${config.port}`)
  })
}
