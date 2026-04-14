import { readHandlerEnvString, readHandlerStrictEnabledFlag, readPositiveIntEnv } from '../config/handlerConfig.js'

type ResolveMode = 'map' | 'ao' | 'hybrid'
type AoLookupResult =
  | { kind: 'resolved'; siteId: string }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; error: string; status: number }

type HostMapParseResult = { ok: true; map: Record<string, string> } | { ok: false }

type CachedAoResolution = {
  siteId?: string
  expiresAt: number
}

export type HostSiteResolution = { ok: true; siteId?: string } | { ok: false; status: number; error: string }

const SITE_RESOLVE_TIMEOUT_DEFAULT_MS = 3_000
const SITE_RESOLVE_CACHE_TTL_DEFAULT_MS = 30_000
const aoResolutionCache = new Map<string, CachedAoResolution>()

function normalizeHost(hostRaw: string): string {
  const normalized = hostRaw.trim().toLowerCase()
  return normalized.replace(/:\d+$/, '')
}

function parseHostMap(raw: string): HostMapParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false }
  }

  const map: Record<string, string> = {}
  for (const [keyRaw, valueRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeHost(String(keyRaw || ''))
    const value = typeof valueRaw === 'string' ? valueRaw.trim() : ''
    if (!key || !value) {
      return { ok: false }
    }
    map[key] = value
  }

  return { ok: true, map }
}

function readResolveMode(): ResolveMode {
  const raw = (readHandlerEnvString('GATEWAY_SITE_RESOLVE_MODE') || 'hybrid').trim().toLowerCase()
  if (raw === 'map' || raw === 'ao' || raw === 'hybrid') {
    return raw
  }
  return 'hybrid'
}

function readResolverBaseUrl(): string | undefined {
  return readHandlerEnvString('GATEWAY_SITE_RESOLVE_AO_URL')
}

function readResolverTimeoutMs(): number {
  return readPositiveIntEnv('GATEWAY_SITE_RESOLVE_TIMEOUT_MS', SITE_RESOLVE_TIMEOUT_DEFAULT_MS)
}

function readResolverCacheTtlMs(): number {
  return readPositiveIntEnv('GATEWAY_SITE_RESOLVE_CACHE_TTL_MS', SITE_RESOLVE_CACHE_TTL_DEFAULT_MS)
}

function allowFallback(): boolean {
  return readHandlerStrictEnabledFlag('GATEWAY_SITE_RESOLVE_ALLOW_BODY_FALLBACK')
}

function readSiteIdFromResolverBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined
  }

  const siteId = (body as { siteId?: unknown }).siteId
  if (typeof siteId === 'string' && siteId.trim()) {
    return siteId.trim()
  }

  const dataSiteId = (body as { data?: { siteId?: unknown } }).data?.siteId
  if (typeof dataSiteId === 'string' && dataSiteId.trim()) {
    return dataSiteId.trim()
  }

  return undefined
}

function cachedAoLookup(host: string): string | undefined | null {
  const cached = aoResolutionCache.get(host)
  if (!cached) {
    return null
  }
  if (cached.expiresAt <= Date.now()) {
    aoResolutionCache.delete(host)
    return null
  }
  return cached.siteId
}

function storeAoLookup(host: string, siteId: string | undefined) {
  const ttlMs = readResolverCacheTtlMs()
  aoResolutionCache.set(host, {
    siteId,
    expiresAt: Date.now() + ttlMs,
  })
}

async function lookupSiteIdViaAo(host: string): Promise<AoLookupResult> {
  const cached = cachedAoLookup(host)
  if (cached !== null) {
    if (cached) {
      return { kind: 'resolved', siteId: cached }
    }
    return { kind: 'not_found' }
  }

  const baseUrl = readResolverBaseUrl()
  if (!baseUrl) {
    return { kind: 'unavailable', error: 'site_resolver_not_configured', status: 503 }
  }

  const endpoint = new URL('/api/public/site-by-host', baseUrl).toString()
  const timeoutMs = readResolverTimeoutMs()

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ host }),
      signal: controller.signal,
    })

    if (response.status === 404) {
      storeAoLookup(host, undefined)
      return { kind: 'not_found' }
    }

    if (!response.ok) {
      return { kind: 'unavailable', error: 'site_resolver_unavailable', status: 503 }
    }

    const body = await response.json().catch(() => null)
    const siteId = readSiteIdFromResolverBody(body)
    if (!siteId) {
      storeAoLookup(host, undefined)
      return { kind: 'not_found' }
    }

    storeAoLookup(host, siteId)
    return { kind: 'resolved', siteId }
  } catch {
    if (timedOut) {
      return { kind: 'unavailable', error: 'site_resolver_timeout', status: 504 }
    }
    return { kind: 'unavailable', error: 'site_resolver_unavailable', status: 503 }
  } finally {
    clearTimeout(timer)
  }
}

function failOrFallback(fallbackAllowed: boolean, error: { status: number; error: string }): HostSiteResolution {
  if (fallbackAllowed) {
    return { ok: true }
  }
  return { ok: false, status: error.status, error: error.error }
}

export async function resolveTemplateSiteIdFromHost(hostRaw: string, productionLikeMode: boolean): Promise<HostSiteResolution> {
  const mode = readResolveMode()
  const host = normalizeHost(hostRaw)

  const mapRaw = readHandlerEnvString('GATEWAY_SITE_ID_BY_HOST_MAP')
  const fallbackAllowed = allowFallback() || (!productionLikeMode && !mapRaw)
  let parsedHostMap: Record<string, string> | undefined

  if (mode !== 'ao' && mapRaw) {
    const parsed = parseHostMap(mapRaw)
    if (!parsed.ok) {
      return { ok: false, status: 500, error: 'site_host_map_invalid' }
    }
    parsedHostMap = parsed.map

    const mapped = parsedHostMap[host] || parsedHostMap.default
    if (mapped) {
      return { ok: true, siteId: mapped }
    }

    if (mode === 'map') {
      return failOrFallback(fallbackAllowed, {
        status: 403,
        error: 'site_host_not_allowed',
      })
    }
  }

  if (mode === 'ao' || mode === 'hybrid') {
    const resolverBaseUrl = readResolverBaseUrl()
    if (!resolverBaseUrl) {
      if (mode === 'ao') {
        return failOrFallback(fallbackAllowed, {
          status: 503,
          error: 'site_resolver_not_configured',
        })
      }

      if (!parsedHostMap) {
        if (!productionLikeMode) {
          return { ok: true }
        }
        return failOrFallback(fallbackAllowed, {
          status: 503,
          error: 'site_resolver_not_configured',
        })
      }

      return failOrFallback(fallbackAllowed, {
        status: 403,
        error: 'site_host_not_allowed',
      })
    }

    const aoLookup = await lookupSiteIdViaAo(host)
    if (aoLookup.kind === 'resolved') {
      return { ok: true, siteId: aoLookup.siteId }
    }

    if (aoLookup.kind === 'not_found') {
      return failOrFallback(fallbackAllowed, {
        status: 403,
        error: 'site_host_not_allowed',
      })
    }

    return failOrFallback(fallbackAllowed, {
      status: aoLookup.status,
      error: aoLookup.error,
    })
  }

  if (mode === 'map' && !parsedHostMap) {
    return failOrFallback(fallbackAllowed, {
      status: 503,
      error: 'site_resolver_not_configured',
    })
  }

  return { ok: true }
}

export function resetTemplateSiteResolverCacheForTests() {
  aoResolutionCache.clear()
}
