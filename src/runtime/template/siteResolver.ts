import { readHandlerEnvString, readHandlerStrictEnabledFlag, readPositiveIntEnv } from '../config/handlerConfig.js'

type ResolveMode = 'map' | 'ao' | 'hybrid'
export type RuntimeRoutingHints = {
  runtime?: Record<string, unknown>
  runtimePointers?: Record<string, unknown>
}
type AoLookupResult =
  | { kind: 'resolved'; siteId: string; runtimeHints?: RuntimeRoutingHints }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; error: string; status: number }

type HostMapParseResult = { ok: true; map: Record<string, string> } | { ok: false }

type CachedAoResolution = {
  siteId?: string
  runtimeHints?: RuntimeRoutingHints
  expiresAt: number
}
type CachedAoUnavailable = {
  error: string
  status: number
  expiresAt: number
}
type ResolverCircuitState = {
  failures: number
  windowStartMs: number
  openUntilMs: number
}

export type HostSiteResolution =
  | { ok: true; siteId?: string; runtimeHints?: RuntimeRoutingHints }
  | { ok: false; status: number; error: string }

const SITE_RESOLVE_TIMEOUT_DEFAULT_MS = 3_000
const SITE_RESOLVE_CACHE_TTL_DEFAULT_MS = 30_000
const SITE_RESOLVE_UNAVAILABLE_CACHE_TTL_DEFAULT_MS = 5_000
const SITE_RESOLVE_GLOBAL_UNAVAILABLE_CACHE_TTL_DEFAULT_MS = 0
const SITE_RESOLVE_BREAKER_THRESHOLD_DEFAULT = 3
const SITE_RESOLVE_BREAKER_WINDOW_DEFAULT_MS = 20_000
const SITE_RESOLVE_BREAKER_OPEN_DEFAULT_MS = 15_000
const aoResolutionCache = new Map<string, CachedAoResolution>()
const aoUnavailableCache = new Map<string, CachedAoUnavailable>()
let globalAoUnavailableCache: CachedAoUnavailable | null = null
const resolverCircuit: ResolverCircuitState = {
  failures: 0,
  windowStartMs: 0,
  openUntilMs: 0,
}
const RUNTIME_POINTER_FIELDS = [
  'processId',
  'siteProcessId',
  'readProcessId',
  'writeProcessId',
  'catalogProcessId',
  'accessProcessId',
  'ingestProcessId',
  'registryProcessId',
  'workerId',
  'workerUrl',
  'updatedAt',
  'sitePid',
  'readPid',
  'writePid',
  'catalogPid',
  'accessPid',
  'ingestPid',
  'registryPid',
  'workerPid',
  'site_process_id',
  'read_process_id',
  'write_process_id',
  'catalog_process_id',
  'access_process_id',
  'ingest_process_id',
  'registry_process_id',
  'worker_id',
  'worker_url',
  'ProcessId',
  'Process-Id',
  'process_id',
  'UpdatedAt',
  'Updated-At',
  'updated_at',
  'moduleId',
  'ModuleId',
  'Module-Id',
  'module_id',
  'scheduler',
  'Scheduler',
  'Scheduler-Id',
  'schedulerId',
  'scheduler_id',
  'templateTxId',
  'TemplateTxId',
  'Template-Tx-Id',
  'template_tx_id',
  'manifestTxId',
  'ManifestTxId',
  'Manifest-Tx-Id',
  'manifest_tx_id',
  'templateSha256',
  'TemplateSha256',
  'Template-Sha256',
  'template_sha256',
  'templateVariant',
  'TemplateVariant',
  'Template-Variant',
  'template_variant',
] as const

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

function readResolverUnavailableCacheTtlMs(): number {
  return readPositiveIntEnv(
    'GATEWAY_SITE_RESOLVE_UNAVAILABLE_CACHE_TTL_MS',
    SITE_RESOLVE_UNAVAILABLE_CACHE_TTL_DEFAULT_MS,
  )
}

function readResolverGlobalUnavailableCacheTtlMs(): number {
  return readPositiveIntEnv(
    'GATEWAY_SITE_RESOLVE_GLOBAL_UNAVAILABLE_CACHE_TTL_MS',
    SITE_RESOLVE_GLOBAL_UNAVAILABLE_CACHE_TTL_DEFAULT_MS,
  )
}

function readResolverBreakerThreshold(): number {
  return readPositiveIntEnv('GATEWAY_SITE_RESOLVE_BREAKER_THRESHOLD', SITE_RESOLVE_BREAKER_THRESHOLD_DEFAULT)
}

function readResolverBreakerWindowMs(): number {
  return readPositiveIntEnv(
    'GATEWAY_SITE_RESOLVE_BREAKER_WINDOW_MS',
    SITE_RESOLVE_BREAKER_WINDOW_DEFAULT_MS,
  )
}

function readResolverBreakerOpenMs(): number {
  return readPositiveIntEnv('GATEWAY_SITE_RESOLVE_BREAKER_OPEN_MS', SITE_RESOLVE_BREAKER_OPEN_DEFAULT_MS)
}

function allowFallback(): boolean {
  return readHandlerStrictEnabledFlag('GATEWAY_SITE_RESOLVE_ALLOW_BODY_FALLBACK')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectScalarRuntimePointers(source: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const key of RUNTIME_POINTER_FIELDS) {
    const value = trimString(source[key])
    if (value) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function collectRuntimeHintsFromRecord(record: Record<string, unknown> | null): RuntimeRoutingHints | undefined {
  if (!record) return undefined
  const runtime = asRecord(record.runtime) || asRecord(record.Runtime) || undefined
  const runtimePointers =
    asRecord(record.runtimePointers) ||
    asRecord(record.RuntimePointers) ||
    asRecord(record.runtimePointer) ||
    asRecord(record.RuntimePointer) ||
    undefined
  const scalarPointers = collectScalarRuntimePointers(record)

  const out: RuntimeRoutingHints = {}
  if (runtime) out.runtime = { ...runtime }
  if (runtimePointers || scalarPointers) {
    out.runtimePointers = {
      ...(runtimePointers ? { ...runtimePointers } : {}),
      ...(scalarPointers ? scalarPointers : {}),
    }
  }
  if (!out.runtime && !out.runtimePointers) return undefined
  return out
}

function mergeRuntimeHints(
  primary?: RuntimeRoutingHints,
  secondary?: RuntimeRoutingHints,
): RuntimeRoutingHints | undefined {
  const mergedRuntime =
    primary?.runtime || secondary?.runtime
      ? {
          ...(secondary?.runtime ? { ...secondary.runtime } : {}),
          ...(primary?.runtime ? { ...primary.runtime } : {}),
        }
      : undefined
  const mergedRuntimePointers =
    primary?.runtimePointers || secondary?.runtimePointers
      ? {
          ...(secondary?.runtimePointers ? { ...secondary.runtimePointers } : {}),
          ...(primary?.runtimePointers ? { ...primary.runtimePointers } : {}),
        }
      : undefined
  if (!mergedRuntime && !mergedRuntimePointers) return undefined
  return {
    ...(mergedRuntime ? { runtime: mergedRuntime } : {}),
    ...(mergedRuntimePointers ? { runtimePointers: mergedRuntimePointers } : {}),
  }
}

function parseResolverBody(body: unknown): { siteId?: string; runtimeHints?: RuntimeRoutingHints } {
  const record = asRecord(body)
  if (!record) return {}
  const payload = asRecord(record.payload)
  const data = asRecord(record.data)
  const bodyData = payload || data

  const siteId =
    trimString(record.siteId) ||
    trimString(payload?.siteId) ||
    trimString(data?.siteId)
  const runtimeHints = mergeRuntimeHints(
    collectRuntimeHintsFromRecord(bodyData),
    collectRuntimeHintsFromRecord(record),
  )
  return {
    ...(siteId ? { siteId } : {}),
    ...(runtimeHints ? { runtimeHints } : {}),
  }
}

function cachedAoLookup(host: string): CachedAoResolution | null {
  const cached = aoResolutionCache.get(host)
  if (!cached) {
    return null
  }
  if (cached.expiresAt <= Date.now()) {
    aoResolutionCache.delete(host)
    return null
  }
  return cached
}

function cachedAoUnavailable(host: string): CachedAoUnavailable | null {
  const cached = aoUnavailableCache.get(host)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    aoUnavailableCache.delete(host)
    return null
  }
  return cached
}

function cachedGlobalAoUnavailable(): CachedAoUnavailable | null {
  const cached = globalAoUnavailableCache
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    globalAoUnavailableCache = null
    return null
  }
  return cached
}

function clearGlobalAoUnavailable() {
  globalAoUnavailableCache = null
}

function storeAoLookup(host: string, siteId: string | undefined, runtimeHints?: RuntimeRoutingHints) {
  const ttlMs = readResolverCacheTtlMs()
  aoResolutionCache.set(host, {
    siteId,
    runtimeHints,
    expiresAt: Date.now() + ttlMs,
  })
  aoUnavailableCache.delete(host)
  clearGlobalAoUnavailable()
}

function storeAoUnavailable(host: string, error: string, status: number) {
  const ttlMs = readResolverUnavailableCacheTtlMs()
  aoUnavailableCache.set(host, {
    error,
    status,
    expiresAt: Date.now() + ttlMs,
  })
  const globalTtlMs = readResolverGlobalUnavailableCacheTtlMs()
  if (globalTtlMs > 0) {
    globalAoUnavailableCache = {
      error,
      status,
      expiresAt: Date.now() + globalTtlMs,
    }
  }
}

function resolverCircuitOpen(now = Date.now()): boolean {
  return resolverCircuit.openUntilMs > now
}

function noteResolverSuccess(now = Date.now()) {
  resolverCircuit.failures = 0
  resolverCircuit.windowStartMs = now
  resolverCircuit.openUntilMs = 0
}

function noteResolverFailure(now = Date.now()) {
  const windowMs = readResolverBreakerWindowMs()
  if (resolverCircuit.windowStartMs <= 0 || now - resolverCircuit.windowStartMs > windowMs) {
    resolverCircuit.windowStartMs = now
    resolverCircuit.failures = 0
  }
  resolverCircuit.failures += 1
  if (resolverCircuit.failures >= readResolverBreakerThreshold()) {
    resolverCircuit.openUntilMs = now + readResolverBreakerOpenMs()
  }
}

async function lookupSiteIdViaAo(host: string): Promise<AoLookupResult> {
  const now = Date.now()
  if (resolverCircuitOpen(now)) {
    return { kind: 'unavailable', error: 'site_resolver_circuit_open', status: 503 }
  }

  const globalUnavailableCached = cachedGlobalAoUnavailable()
  if (globalUnavailableCached) {
    return {
      kind: 'unavailable',
      error: globalUnavailableCached.error,
      status: globalUnavailableCached.status,
    }
  }

  const unavailableCached = cachedAoUnavailable(host)
  if (unavailableCached) {
    return {
      kind: 'unavailable',
      error: unavailableCached.error,
      status: unavailableCached.status,
    }
  }

  const cached = cachedAoLookup(host)
  if (cached !== null) {
    if (cached.siteId) {
      return {
        kind: 'resolved',
        siteId: cached.siteId,
        ...(cached.runtimeHints ? { runtimeHints: cached.runtimeHints } : {}),
      }
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
      noteResolverSuccess()
      return { kind: 'not_found' }
    }

    if (!response.ok) {
      noteResolverFailure()
      storeAoUnavailable(host, 'site_resolver_unavailable', 503)
      return { kind: 'unavailable', error: 'site_resolver_unavailable', status: 503 }
    }

    const body = await response.json().catch(() => null)
    const parsed = parseResolverBody(body)
    if (!parsed.siteId) {
      storeAoLookup(host, undefined)
      noteResolverSuccess()
      return { kind: 'not_found' }
    }

    storeAoLookup(host, parsed.siteId, parsed.runtimeHints)
    noteResolverSuccess()
    return {
      kind: 'resolved',
      siteId: parsed.siteId,
      ...(parsed.runtimeHints ? { runtimeHints: parsed.runtimeHints } : {}),
    }
  } catch {
    if (timedOut) {
      noteResolverFailure()
      storeAoUnavailable(host, 'site_resolver_timeout', 504)
      return { kind: 'unavailable', error: 'site_resolver_timeout', status: 504 }
    }
    noteResolverFailure()
    storeAoUnavailable(host, 'site_resolver_unavailable', 503)
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
      return {
        ok: true,
        siteId: aoLookup.siteId,
        ...(aoLookup.runtimeHints ? { runtimeHints: aoLookup.runtimeHints } : {}),
      }
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
  aoUnavailableCache.clear()
  globalAoUnavailableCache = null
  resolverCircuit.failures = 0
  resolverCircuit.windowStartMs = 0
  resolverCircuit.openUntilMs = 0
}
