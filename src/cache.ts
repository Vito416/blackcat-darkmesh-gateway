import { inc, gauge } from './metrics.js'

export type CacheIntegrityMeta = {
  verified: boolean
  root?: string
  hash?: string
  verifiedAt?: number
}

type CacheEntry = { value: ArrayBuffer; expiresAt: number; integrity?: CacheIntegrityMeta }
type PutOptions = { subject?: string; integrity?: CacheIntegrityMeta }
type FetchOptions = { requireVerified?: boolean }
export type CacheFetchResult =
  | { status: 'hit'; value: ArrayBuffer; integrity?: CacheIntegrityMeta }
  | { status: 'miss' | 'expired' | 'unverified' }

const store = new Map<string, CacheEntry>()
const subjects = new Map<string, Set<string>>()
const TTL_MS = parseInt(process.env.GATEWAY_CACHE_TTL_MS || '300000', 10) || 300000
gauge('gateway_cache_ttl_ms', TTL_MS)

export function put(key: string, value: ArrayBuffer, subjectOrOptions?: string | PutOptions) {
  const opts: PutOptions =
    typeof subjectOrOptions === 'string'
      ? { subject: subjectOrOptions }
      : subjectOrOptions || {}

  store.set(key, { value, expiresAt: Date.now() + TTL_MS, integrity: opts.integrity })
  if (opts.subject) {
    const set = subjects.get(opts.subject) || new Set<string>()
    set.add(key)
    subjects.set(opts.subject, set)
  }
  gauge('gateway_cache_size', store.size)
}

export function fetchEntry(key: string, options: FetchOptions = {}): CacheFetchResult {
  const entry = store.get(key)
  if (!entry) {
    inc('gateway_cache_miss')
    return { status: 'miss' }
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    inc('gateway_cache_expired')
    gauge('gateway_cache_size', store.size)
    return { status: 'expired' }
  }
  if (options.requireVerified && !entry.integrity?.verified) {
    inc('gateway_integrity_unverified_block')
    return { status: 'unverified' }
  }
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
      for (const [subj, set] of subjects.entries()) {
        set.delete(k)
        if (set.size === 0) subjects.delete(subj)
      }
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
    if (store.delete(key)) removed = removed + 1
  }
  subjects.delete(subject)
  gauge('gateway_cache_size', store.size)
  return removed
}

export function dropKey(key: string): boolean {
  const ok = store.delete(key)
  if (ok) {
    for (const [subj, set] of subjects.entries()) {
      set.delete(key)
      if (set.size === 0) subjects.delete(subj)
    }
    gauge('gateway_cache_size', store.size)
  }
  return ok
}
