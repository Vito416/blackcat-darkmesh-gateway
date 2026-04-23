export type DomainMapStatus = 'valid' | 'stale' | 'invalid'

export interface DomainMapError {
  code: string
  message: string
  at: number
}

export interface DomainMapEntry {
  schemaVersion: number
  host: string
  status: DomainMapStatus
  cfgTx: string | null
  resolvedTarget: string | null
  writeProcess: string | null
  configHash: string | null
  verifiedAt: number | null
  expiresAt: number | null
  hbVerifiedAt: number | null
  hardExpiresAt: number | null
  lastError: DomainMapError | null
  lastSuccessAt: number | null
  lastErrorAt: number | null
  lastErrorCode: string | null
  refreshAttempts: number
  updatedAt: number
}

export interface DomainMapKvAdapter {
  put(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
  list(prefix?: string): Promise<string[]>
  delete(key: string): Promise<void>
}

const DOMAIN_KEY_PREFIX = 'domain:'
const DOMAIN_MAP_FALLBACK_HOST = 'invalid.local'
export const DOMAIN_MAP_SCHEMA_VERSION = 2

type JsonRecord = Record<string, unknown>

export class InMemoryDomainMapKvAdapter implements DomainMapKvAdapter {
  private readonly store = new Map<string, string>()

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async list(prefix = ''): Promise<string[]> {
    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix))
    keys.sort()
    return keys
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

export interface DomainStatusMetadataPatch {
  status?: DomainMapStatus
  verifiedAt?: number | null
  expiresAt?: number | null
  hbVerifiedAt?: number | null
  hardExpiresAt?: number | null
  lastError?: DomainMapError | null
  lastSuccessAt?: number | null
  lastErrorAt?: number | null
  lastErrorCode?: string | null
  refreshAttempts?: number
  nowMs?: number
}

export function normalizeDomainHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  if (!normalized) {
    throw new Error('domain_host_required')
  }
  return normalized
}

export function domainMapKey(host: string): string {
  return `${DOMAIN_KEY_PREFIX}${normalizeDomainHost(host)}`
}

export function createEmptyDomainMapEntry(host: string, nowMs = Date.now()): DomainMapEntry {
  return {
    schemaVersion: DOMAIN_MAP_SCHEMA_VERSION,
    host: normalizeDomainHost(host),
    status: 'invalid',
    cfgTx: null,
    resolvedTarget: null,
    writeProcess: null,
    configHash: null,
    verifiedAt: null,
    expiresAt: null,
    hbVerifiedAt: null,
    hardExpiresAt: null,
    lastError: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    refreshAttempts: 0,
    updatedAt: nowMs
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return Math.floor(value)
}

function asStatus(value: unknown): DomainMapStatus {
  if (value === 'valid' || value === 'stale') {
    return value
  }
  return 'invalid'
}

function safeNormalizeDomainHost(host: unknown, hostHint?: string): string {
  const candidate = typeof host === 'string' ? host : hostHint ?? DOMAIN_MAP_FALLBACK_HOST
  try {
    return normalizeDomainHost(candidate)
  } catch {
    return DOMAIN_MAP_FALLBACK_HOST
  }
}

function parseDomainMapError(value: unknown, nowMs: number): DomainMapError | null {
  if (!isJsonRecord(value)) {
    return null
  }
  const code = asNullableString(value.code) ?? 'error'
  const message = asNullableString(value.message) ?? 'unknown_error'
  const at = asNullableNumber(value.at) ?? nowMs
  return { code, message, at }
}

function makeCorruptedDomainMapEntry(
  hostHint: string | undefined,
  nowMs: number,
  code: string,
  message: string
): DomainMapEntry {
  return {
    ...createEmptyDomainMapEntry(hostHint ?? DOMAIN_MAP_FALLBACK_HOST, nowMs),
    status: 'invalid',
    lastError: { code, message, at: nowMs },
    lastErrorAt: nowMs,
    lastErrorCode: code,
    updatedAt: nowMs
  }
}

function migratePersistedRecord(
  parsed: JsonRecord,
  version: number,
  hostHint: string | undefined,
  nowMs: number
): DomainMapEntry {
  const entry = createEmptyDomainMapEntry(safeNormalizeDomainHost(parsed.host, hostHint), nowMs)
  entry.schemaVersion = DOMAIN_MAP_SCHEMA_VERSION
  entry.status = asStatus(parsed.status)
  entry.cfgTx = asNullableString(parsed.cfgTx)
  entry.resolvedTarget = asNullableString(parsed.resolvedTarget)
  entry.writeProcess = asNullableString(parsed.writeProcess)
  entry.configHash = asNullableString(parsed.configHash)
  entry.verifiedAt = asNullableNumber(parsed.verifiedAt)
  entry.expiresAt = asNullableNumber(parsed.expiresAt)
  entry.hbVerifiedAt = asNullableNumber(parsed.hbVerifiedAt)
  entry.hardExpiresAt = asNullableNumber(parsed.hardExpiresAt)
  entry.lastError = parseDomainMapError(parsed.lastError, nowMs)
  entry.lastSuccessAt = asNullableNumber(parsed.lastSuccessAt)
  entry.lastErrorAt = asNullableNumber(parsed.lastErrorAt)
  entry.lastErrorCode = asNullableString(parsed.lastErrorCode)
  entry.refreshAttempts = asNonNegativeInt(parsed.refreshAttempts, 0)
  entry.updatedAt = asNullableNumber(parsed.updatedAt) ?? nowMs

  if (entry.lastError && entry.lastErrorAt === null) {
    entry.lastErrorAt = entry.lastError.at
  }
  if (entry.lastError && entry.lastErrorCode === null) {
    entry.lastErrorCode = entry.lastError.code
  }

  // v0/v1 records can miss these audit fields; migrate with deterministic defaults.
  if (version <= 1) {
    entry.lastSuccessAt = entry.lastSuccessAt ?? entry.verifiedAt
    entry.refreshAttempts = entry.refreshAttempts ?? 0
  }

  return entry
}

export function parseDomainMapEntry(raw: string, hostHint?: string): DomainMapEntry {
  const nowMs = Date.now()
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(raw)
  } catch {
    return makeCorruptedDomainMapEntry(hostHint, nowMs, 'corrupt_json', 'Failed to parse persisted domain record JSON.')
  }

  if (!isJsonRecord(parsedUnknown)) {
    return makeCorruptedDomainMapEntry(hostHint, nowMs, 'invalid_shape', 'Persisted domain record is not an object.')
  }

  const versionRaw = parsedUnknown.schemaVersion
  const version = versionRaw === undefined ? 0 : asNonNegativeInt(versionRaw, -1)
  if (version < 0) {
    return makeCorruptedDomainMapEntry(
      hostHint,
      nowMs,
      'invalid_schema_version',
      'Persisted domain record has invalid schemaVersion.'
    )
  }

  if (version > DOMAIN_MAP_SCHEMA_VERSION) {
    return makeCorruptedDomainMapEntry(
      safeNormalizeDomainHost(parsedUnknown.host, hostHint),
      nowMs,
      'unsupported_schema_version',
      `Persisted domain record schemaVersion ${version} is newer than supported ${DOMAIN_MAP_SCHEMA_VERSION}.`
    )
  }

  return migratePersistedRecord(parsedUnknown, version, hostHint, nowMs)
}

export async function getDomainMapEntry(
  kv: DomainMapKvAdapter,
  host: string
): Promise<DomainMapEntry | null> {
  const raw = await kv.get(domainMapKey(host))
  if (!raw) {
    return null
  }
  return parseDomainMapEntry(raw, host)
}

export async function putDomainMapEntry(kv: DomainMapKvAdapter, entry: DomainMapEntry): Promise<void> {
  await kv.put(domainMapKey(entry.host), JSON.stringify(entry))
}

export async function deleteDomainMapEntry(kv: DomainMapKvAdapter, host: string): Promise<void> {
  await kv.delete(domainMapKey(host))
}

export async function listDomainMapEntries(
  kv: DomainMapKvAdapter,
  hostPrefix?: string
): Promise<DomainMapEntry[]> {
  const normalizedPrefix = hostPrefix ? normalizeDomainHost(hostPrefix) : ''
  const keyPrefix = `${DOMAIN_KEY_PREFIX}${normalizedPrefix}`
  const keys = await kv.list(keyPrefix)
  const entries = await Promise.all(
    keys.map(async (key) => {
      const raw = await kv.get(key)
      if (!raw) {
        return null
      }
      const hostHint = key.startsWith(DOMAIN_KEY_PREFIX)
        ? key.slice(DOMAIN_KEY_PREFIX.length)
        : DOMAIN_MAP_FALLBACK_HOST
      return parseDomainMapEntry(raw, hostHint)
    })
  )
  return entries.filter((entry): entry is DomainMapEntry => Boolean(entry))
}

/**
 * Writes all metadata fields in one serialized KV write to avoid partial updates.
 */
export async function upsertDomainStatusMetadata(
  kv: DomainMapKvAdapter,
  host: string,
  patch: DomainStatusMetadataPatch
): Promise<DomainMapEntry> {
  const normalizedHost = normalizeDomainHost(host)
  const key = domainMapKey(normalizedHost)
  const nowMs = patch.nowMs ?? Date.now()
  const existingRaw = await kv.get(key)
  const next = existingRaw
    ? parseDomainMapEntry(existingRaw, normalizedHost)
    : createEmptyDomainMapEntry(normalizedHost, nowMs)

  if ('status' in patch) next.status = patch.status ?? 'invalid'
  if ('verifiedAt' in patch) next.verifiedAt = patch.verifiedAt ?? null
  if ('expiresAt' in patch) next.expiresAt = patch.expiresAt ?? null
  if ('hbVerifiedAt' in patch) next.hbVerifiedAt = patch.hbVerifiedAt ?? null
  if ('hardExpiresAt' in patch) next.hardExpiresAt = patch.hardExpiresAt ?? null
  if ('lastError' in patch) next.lastError = patch.lastError ?? null
  if ('lastSuccessAt' in patch) next.lastSuccessAt = patch.lastSuccessAt ?? null
  if ('lastErrorAt' in patch) next.lastErrorAt = patch.lastErrorAt ?? null
  if ('lastErrorCode' in patch) next.lastErrorCode = patch.lastErrorCode ?? null
  if ('refreshAttempts' in patch) next.refreshAttempts = patch.refreshAttempts ?? 0

  if ('lastError' in patch && patch.lastError) {
    next.lastErrorAt = patch.lastError.at
    next.lastErrorCode = patch.lastError.code
  }
  next.updatedAt = nowMs

  await kv.put(key, JSON.stringify(next))
  return next
}
