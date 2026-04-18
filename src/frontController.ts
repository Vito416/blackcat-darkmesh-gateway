import { inc } from './metrics.js'
import { sha256Hex } from './integrity/verifier.js'
import { loadIntegerConfig, loadStringConfig } from './runtime/config/loader.js'

type CachedTemplate = {
  txId: string
  templateSha256: string
  html: string
  contentType: string
  expiresAt: number
}

type TemplateIndexRecord = {
  txId: string
  templateSha256?: string
  manifestTxId?: string
  source: 'index' | 'host-map' | 'default'
}

const DEFAULT_TIMEOUT_MS = 4000
const DEFAULT_CACHE_TTL_MS = 60_000
const DEFAULT_AR_GATEWAY = 'https://arweave.net'
const SHA256_HEX_RE = /^[A-Fa-f0-9]{64}$/
const TX_ID_RE = /^[A-Za-z0-9_-]{8,128}$/
const cacheByHost = new Map<string, CachedTemplate>()

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '')
}

function readStringEnv(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok) return undefined
  return asString(loaded.value)
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
  if (!loaded.ok || typeof loaded.value !== 'number' || loaded.value <= 0) return fallback
  return Math.floor(loaded.value)
}

function readFrontControllerTimeoutMs(): number {
  return readPositiveIntEnv('GATEWAY_FRONT_CONTROLLER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
}

function readFrontControllerCacheTtlMs(): number {
  return readPositiveIntEnv('GATEWAY_FRONT_CONTROLLER_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS)
}

function readArGatewayBaseUrl(): string {
  const configured = readStringEnv('GATEWAY_FRONT_CONTROLLER_AR_GATEWAY_URL')
  if (!configured) return DEFAULT_AR_GATEWAY
  return configured.replace(/\/+$/, '')
}

function parseTxId(value: unknown): string | null {
  const txId = asString(value)
  if (!txId) return null
  if (!TX_ID_RE.test(txId)) return null
  return txId
}

function parseSha256(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  let normalized = raw
  if (normalized.toLowerCase().startsWith('sha256-')) {
    normalized = normalized.slice(7)
  }
  if (normalized.toLowerCase().startsWith('0x')) {
    normalized = normalized.slice(2)
  }
  if (!SHA256_HEX_RE.test(normalized)) return null
  return normalized.toLowerCase()
}

function readRequireHash(): boolean {
  return isTruthy(readStringEnv('GATEWAY_FRONT_CONTROLLER_REQUIRE_HASH'))
}

function readFallbackExpectedHash(): string | null {
  return parseSha256(readStringEnv('GATEWAY_FRONT_CONTROLLER_TEMPLATE_SHA256'))
}

function parseTemplateMap(raw: string): Record<string, { txId: string; templateSha256?: string; manifestTxId?: string }> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const map: Record<string, { txId: string; templateSha256?: string; manifestTxId?: string }> = {}
  for (const [keyRaw, valueRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeHost(String(keyRaw || ''))
    if (!key) return null
    const entry = valueRaw as Record<string, unknown> | null
    const txId = parseTxId(valueRaw) || parseTxId(entry?.templateTxId) || parseTxId(entry?.txId)
    if (!txId) return null
    const templateSha256 = parseSha256(entry?.templateSha256) || parseSha256(entry?.sha256) || parseSha256(entry?.hash) || undefined
    const manifestTxId = parseTxId(entry?.manifestTxId) || undefined
    map[key] = {
      txId,
      ...(templateSha256 ? { templateSha256 } : {}),
      ...(manifestTxId ? { manifestTxId } : {}),
    }
  }
  return map
}

function parseTemplateRecord(value: unknown): TemplateIndexRecord | null {
  const entry = value as Record<string, unknown> | null
  const txId = parseTxId(value) || parseTxId(entry?.templateTxId) || parseTxId(entry?.txId)
  if (!txId) return null
  const templateSha256 = parseSha256(entry?.templateSha256) || parseSha256(entry?.sha256) || parseSha256(entry?.hash) || undefined
  const manifestTxId = parseTxId(entry?.manifestTxId) || undefined
  return {
    txId,
    ...(templateSha256 ? { templateSha256 } : {}),
    ...(manifestTxId ? { manifestTxId } : {}),
    source: 'index',
  }
}

function fromIndexHostMap(payload: Record<string, unknown>, host: string): TemplateIndexRecord | null {
  const candidates = [payload.hosts, payload.byHost, payload.sites, payload.map]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = (candidate as Record<string, unknown>)[host] ?? (candidate as Record<string, unknown>)['*']
    const parsed = parseTemplateRecord(record)
    if (parsed) return parsed
  }
  return null
}

function resolveTemplateFromIndexPayload(payload: unknown, host: string): TemplateIndexRecord | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>

  const hostMapped = fromIndexHostMap(record, host)
  if (hostMapped) return hostMapped

  const latest = parseTemplateRecord(record) || parseTemplateRecord(record.latest)
  if (latest) return latest

  const fallback = parseTemplateRecord(record.default)
  if (fallback) return fallback

  return null
}

function isTruthy(raw: string | undefined): boolean {
  const value = (raw || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function isFrontControllerEnabled(): boolean {
  const explicit = readStringEnv('GATEWAY_FRONT_CONTROLLER_ENABLED')
  if (explicit !== undefined) return isTruthy(explicit)
  return Boolean(
    readStringEnv('GATEWAY_FRONT_CONTROLLER_TEMPLATE_TXID') ||
      readStringEnv('GATEWAY_FRONT_CONTROLLER_TEMPLATE_MAP') ||
      readStringEnv('GATEWAY_FRONT_CONTROLLER_INDEX_URL'),
  )
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function resolveTemplateRecord(host: string, timeoutMs: number): Promise<TemplateIndexRecord | null> {
  const mapRaw = readStringEnv('GATEWAY_FRONT_CONTROLLER_TEMPLATE_MAP')
  if (mapRaw) {
    const map = parseTemplateMap(mapRaw)
    if (!map) throw new Error('front_controller_template_map_invalid')
    const mapped = map[host] || map['*']
    if (mapped) {
      return {
        txId: mapped.txId,
        ...(mapped.templateSha256 ? { templateSha256: mapped.templateSha256 } : {}),
        ...(mapped.manifestTxId ? { manifestTxId: mapped.manifestTxId } : {}),
        source: 'host-map',
      }
    }
  }

  const indexUrl = readStringEnv('GATEWAY_FRONT_CONTROLLER_INDEX_URL')
  if (indexUrl) {
    const response = await fetchTextWithTimeout(indexUrl, timeoutMs)
    if (!response.ok) {
      throw new Error(`front_controller_index_http_${response.status}`)
    }
    const payload = await response.json().catch(() => null)
    const resolved = resolveTemplateFromIndexPayload(payload, host)
    if (resolved) return resolved
  }

  const fallbackTxId = parseTxId(readStringEnv('GATEWAY_FRONT_CONTROLLER_TEMPLATE_TXID'))
  if (fallbackTxId) {
    const fallbackHash = readFallbackExpectedHash() || undefined
    return {
      txId: fallbackTxId,
      ...(fallbackHash ? { templateSha256: fallbackHash } : {}),
      source: 'default',
    }
  }

  return null
}

function buildHtmlResponse(
  html: string,
  contentType: string,
  txId: string,
  templateSha256: string,
  cacheState: 'hit' | 'miss' | 'stale',
  source: string,
): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': contentType || 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-front-controller': '1',
      'x-front-controller-cache': cacheState,
      'x-front-controller-source': source,
      'x-front-controller-template-txid': txId,
      'x-front-controller-template-sha256': templateSha256,
    },
  })
}

export async function handleFrontControllerRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method', { status: 405 })
  }

  if (!isFrontControllerEnabled()) {
    return new Response(JSON.stringify({ error: 'front_controller_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }

  const now = Date.now()
  const host = normalizeHost(new URL(request.url).host)
  const timeoutMs = readFrontControllerTimeoutMs()
  const cacheTtlMs = readFrontControllerCacheTtlMs()
  const requireHash = readRequireHash()
  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1'
  const cached = cacheByHost.get(host)
  if (cached && !forceRefresh && cached.expiresAt > now) {
    inc('gateway_front_controller_cache_hit')
    return buildHtmlResponse(cached.html, cached.contentType, cached.txId, cached.templateSha256, 'hit', 'cache')
  }

  let resolved: TemplateIndexRecord | null
  try {
    resolved = await resolveTemplateRecord(host, timeoutMs)
  } catch (error) {
    inc('gateway_front_controller_refresh_fail')
    if (cached) {
      return buildHtmlResponse(cached.html, cached.contentType, cached.txId, cached.templateSha256, 'stale', 'cache')
    }
    return new Response(
      JSON.stringify({ error: 'front_controller_index_unavailable', detail: error instanceof Error ? error.message : 'unknown' }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  if (!resolved) {
    if (cached) return buildHtmlResponse(cached.html, cached.contentType, cached.txId, cached.templateSha256, 'stale', 'cache')
    return new Response(JSON.stringify({ error: 'front_controller_template_txid_missing' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (cached && cached.txId === resolved.txId && !forceRefresh) {
    cached.expiresAt = now + cacheTtlMs
    inc('gateway_front_controller_cache_hit')
    return buildHtmlResponse(cached.html, cached.contentType, cached.txId, cached.templateSha256, 'hit', resolved.source)
  }

  const templateUrl = `${readArGatewayBaseUrl()}/${resolved.txId}`
  try {
    const response = await fetchTextWithTimeout(templateUrl, timeoutMs)
    if (!response.ok) {
      throw new Error(`front_controller_template_http_${response.status}`)
    }
    const html = await response.text()
    if (!html || html.trim().length === 0) {
      throw new Error('front_controller_template_empty')
    }
    const actualSha256 = sha256Hex(html)
    const expectedSha256 = resolved.templateSha256
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new Error('front_controller_template_hash_mismatch')
    }
    if (requireHash && !expectedSha256) {
      throw new Error('front_controller_template_hash_required')
    }
    const contentType = response.headers.get('content-type') || 'text/html; charset=utf-8'
    cacheByHost.set(host, {
      txId: resolved.txId,
      templateSha256: actualSha256,
      html,
      contentType,
      expiresAt: now + cacheTtlMs,
    })
    inc('gateway_front_controller_cache_miss')
    return buildHtmlResponse(html, contentType, resolved.txId, actualSha256, 'miss', resolved.source)
  } catch (error) {
    inc('gateway_front_controller_refresh_fail')
    if (cached) {
      return buildHtmlResponse(cached.html, cached.contentType, cached.txId, cached.templateSha256, 'stale', 'cache')
    }
    return new Response(
      JSON.stringify({ error: 'front_controller_template_unavailable', detail: error instanceof Error ? error.message : 'unknown' }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}

export function resetFrontControllerCacheForTests(): void {
  cacheByHost.clear()
}
