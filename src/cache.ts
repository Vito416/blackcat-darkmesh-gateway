import { inc, gauge } from './metrics.js'
import { loadIntegerConfig, loadStringConfig } from './runtime/config/loader.js'

export type CacheIntegrityMeta = {
  verified: boolean
  root?: string
  hash?: string
  verifiedAt?: number
}

type CacheEntry = { value: ArrayBuffer; expiresAt: number; integrity?: CacheIntegrityMeta }
type PutOptions = { subject?: string; integrity?: CacheIntegrityMeta }
type FetchOptions = { requireVerified?: boolean }
type AdmissionMode = 'reject' | 'evict_lru'
export type CacheFetchResult =
  | { status: 'hit'; value: ArrayBuffer; integrity?: CacheIntegrityMeta }
  | { status: 'miss' | 'expired' | 'unverified' }

const store = new Map<string, CacheEntry>()
const subjects = new Map<string, Set<string>>()
const keySubject = new Map<string, string>()
const TTL_MS = readPositiveEnvInt(['GATEWAY_CACHE_TTL_MS'], 300000)
const MAX_ENTRY_BYTES = readPositiveEnvInt(
  ['GATEWAY_CACHE_MAX_ENTRY_BYTES', 'GATEWAY_CACHE_ENTRY_MAX_BYTES'],
  256 * 1024,
)
const MAX_ENTRIES = readPositiveEnvInt(
  ['GATEWAY_CACHE_MAX_ENTRIES', 'GATEWAY_CACHE_MAX_COUNT', 'GATEWAY_CACHE_ENTRY_LIMIT'],
  256,
)
const MAX_KEYS_PER_SUBJECT = readPositiveEnvInt(['GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT'], 64)
const ADMISSION_MODE = readAdmissionMode()

gauge('gateway_cache_ttl_ms', TTL_MS)
gauge('gateway_cache_max_entry_bytes', MAX_ENTRY_BYTES)
gauge('gateway_cache_max_entries', MAX_ENTRIES)
gauge('gateway_cache_max_keys_per_subject', MAX_KEYS_PER_SUBJECT)
gauge('gateway_cache_admission_mode', ADMISSION_MODE === 'evict_lru' ? 1 : 0)

function readPositiveEnvInt(names: string[], fallback: number): number {
  for (const name of names) {
    const loaded = loadIntegerConfig(name)
    if (!loaded.ok || loaded.value === undefined) continue
    if (Number.isFinite(loaded.value) && loaded.value > 0) return Math.floor(loaded.value)
  }
  return fallback
}

function readAdmissionMode(): AdmissionMode {
  const loaded = loadStringConfig('GATEWAY_CACHE_ADMISSION_MODE')
  if (!loaded.ok || typeof loaded.value !== 'string') return 'reject'
  const raw = loaded.value.trim().toLowerCase()
  if (raw === 'evict_lru') return 'evict_lru'
  return 'reject'
}

function detachKeyFromSubjects(key: string) {
  const subject = keySubject.get(key)
  if (!subject) return
  const set = subjects.get(subject)
  if (set) {
    set.delete(key)
    if (set.size === 0) subjects.delete(subject)
  }
  keySubject.delete(key)
}

function attachKeyToSubject(key: string, subject: string) {
  detachKeyFromSubjects(key)
  const set = subjects.get(subject) || new Set<string>()
  set.add(key)
  subjects.set(subject, set)
  keySubject.set(key, subject)
}

function canAdmitSubjectKey(key: string, subject: string): boolean {
  const set = subjects.get(subject)
  if (!set) return true
  if (set.has(key)) return true
  return set.size < MAX_KEYS_PER_SUBJECT
}

function touchKey(key: string) {
  const entry = store.get(key)
  if (!entry) return
  store.delete(key)
  store.set(key, entry)
}

function evictOldestKey(): boolean {
  const oldest = store.keys().next().value as string | undefined
  if (!oldest) return false
  store.delete(oldest)
  detachKeyFromSubjects(oldest)
  inc('gateway_cache_evict_lru')
  return true
}

export function put(key: string, value: ArrayBuffer, subjectOrOptions?: string | PutOptions): boolean {
  const opts: PutOptions =
    typeof subjectOrOptions === 'string'
      ? { subject: subjectOrOptions }
      : subjectOrOptions || {}

  // Reclaim expired entries before admission so stale items do not hold budget.
  sweep()
  if (value.byteLength > MAX_ENTRY_BYTES) {
    inc('gateway_cache_store_reject')
    inc('gateway_cache_store_reject_size')
    return false
  }

  if (opts.subject && !canAdmitSubjectKey(key, opts.subject)) {
    inc('gateway_cache_store_reject')
    inc('gateway_cache_store_reject_subject')
    return false
  }

  const existed = store.has(key)
  if (!existed && store.size >= MAX_ENTRIES) {
    if (ADMISSION_MODE === 'evict_lru') {
      const evicted = evictOldestKey()
      if (!evicted) {
        inc('gateway_cache_store_reject')
        inc('gateway_cache_store_reject_capacity')
        return false
      }
    } else {
      inc('gateway_cache_store_reject')
      inc('gateway_cache_store_reject_capacity')
      return false
    }
  }

  if (existed) {
    store.delete(key)
  }
  store.set(key, { value, expiresAt: Date.now() + TTL_MS, integrity: opts.integrity })
  if (opts.subject) {
    attachKeyToSubject(key, opts.subject)
  } else if (existed && keySubject.has(key)) {
    // Keep the previous subject association if the caller only refreshed value.
    const subject = keySubject.get(key)
    if (subject) {
      const set = subjects.get(subject) || new Set<string>()
      set.add(key)
      subjects.set(subject, set)
      keySubject.set(key, subject)
    }
  }
  gauge('gateway_cache_size', store.size)
  return true
}

export function fetchEntry(key: string, options: FetchOptions = {}): CacheFetchResult {
  const entry = store.get(key)
  if (!entry) {
    inc('gateway_cache_miss')
    return { status: 'miss' }
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    detachKeyFromSubjects(key)
    inc('gateway_cache_expired')
    gauge('gateway_cache_size', store.size)
    return { status: 'expired' }
  }
  if (options.requireVerified && !entry.integrity?.verified) {
    inc('gateway_integrity_unverified_block')
    return { status: 'unverified' }
  }
  touchKey(key)
  inc('gateway_cache_hit')
  return { status: 'hit', value: entry.value, integrity: entry.integrity }
}

export function get(key: string): ArrayBuffer | null {
  const result = fetchEntry(key)
  if (result.status !== 'hit') return null
  return result.value
}

export function sweep() {
  const now = Date.now()
  let removed = 0
  for (const [k, v] of store.entries()) {
    if (v.expiresAt <= now) {
      store.delete(k)
      detachKeyFromSubjects(k)
      removed++
    }
  }
  if (removed > 0) {
    inc('gateway_cache_swept', removed)
    gauge('gateway_cache_size', store.size)
  }
}

export function forgetSubject(subject: string): number {
  const set = subjects.get(subject)
  if (!set) return 0
  let removed = 0
  for (const key of set) {
    if (store.delete(key)) {
      removed = removed + 1
      keySubject.delete(key)
    }
  }
  subjects.delete(subject)
  gauge('gateway_cache_size', store.size)
  return removed
}

export function dropKey(key: string): boolean {
  const ok = store.delete(key)
  if (ok) {
    detachKeyFromSubjects(key)
    gauge('gateway_cache_size', store.size)
  }
  return ok
}
