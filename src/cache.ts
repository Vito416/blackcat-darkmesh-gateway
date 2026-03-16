import { inc, gauge } from './metrics'

type CacheEntry = { value: ArrayBuffer; expiresAt: number }

const store = new Map<string, CacheEntry>()
const TTL_MS = (parseInt(process.env.GATEWAY_CACHE_TTL_MS || '300000', 10) || 300000)

export function put(key: string, value: ArrayBuffer) {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS })
  gauge('gateway.cache.size', store.size)
}

export function get(key: string): ArrayBuffer | null {
  const entry = store.get(key)
  if (!entry) {
    inc('gateway.cache.miss')
    return null
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    inc('gateway.cache.expired')
    gauge('gateway.cache.size', store.size)
    return null
  }
  inc('gateway.cache.hit')
  return entry.value
}

export function sweep() {
  const now = Date.now()
  let removed = 0
  for (const [k, v] of store.entries()) {
    if (v.expiresAt <= now) {
      store.delete(k)
      removed++
    }
  }
  if (removed > 0) {
    inc('gateway.cache.swept', removed)
    gauge('gateway.cache.size', store.size)
  }
}
