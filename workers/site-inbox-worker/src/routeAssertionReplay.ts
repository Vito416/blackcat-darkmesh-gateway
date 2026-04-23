import type { Env } from './types'

type ReplayClaimResult =
  | { ok: true; replayed: false }
  | { ok: true; replayed: true }
  | { ok: false; code: string }

const memoryReplay = new Map<string, number>()
const localClaimLocks = new Set<string>()
const MAX_REPLAY_TTL_SEC = 86400

function cleanEnv(value?: string | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseBooleanLike(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function replayEnabled(env: Env) {
  return parseBooleanLike((env as any).ROUTE_ASSERT_VERIFY_REPLAY_ENABLED)
}

function useInMemoryReplay(env: Env) {
  return parseBooleanLike((env as any).TEST_IN_MEMORY_KV)
}

function replayTtl(assertionExp: number, env: Env) {
  const configured = Number.parseInt(cleanEnv((env as any).ROUTE_ASSERT_VERIFY_REPLAY_TTL_SEC), 10)
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(MAX_REPLAY_TTL_SEC, Math.max(1, Math.trunc(configured)))
  }
  const now = Math.floor(Date.now() / 1000)
  const remaining = assertionExp - now
  return Math.min(MAX_REPLAY_TTL_SEC, Math.max(1, remaining))
}

function replayKey(nonce: string, domain: string, cfgTx: string) {
  return `route-assert:verify:${domain}:${cfgTx}:${nonce}`
}

function clearExpiredMemoryReplay(now: number) {
  for (const [key, exp] of memoryReplay.entries()) {
    if (exp <= now) memoryReplay.delete(key)
  }
}

export async function claimRouteAssertionReplay(
  env: Env,
  assertion: { challengeNonce: string; domain: string; cfgTx: string; exp: number },
): Promise<ReplayClaimResult> {
  if (!replayEnabled(env)) {
    return { ok: true, replayed: false }
  }

  const key = replayKey(assertion.challengeNonce, assertion.domain, assertion.cfgTx)
  const now = Math.floor(Date.now() / 1000)
  const ttl = replayTtl(assertion.exp, env)
  if (ttl <= 0) {
    return { ok: false, code: 'replay_ttl_invalid' }
  }

  if (useInMemoryReplay(env) || !(env as any).INBOX_KV) {
    clearExpiredMemoryReplay(now)
    const seenUntil = memoryReplay.get(key)
    if (typeof seenUntil === 'number' && seenUntil > now) {
      return { ok: true, replayed: true }
    }
    memoryReplay.set(key, now + ttl)
    return { ok: true, replayed: false }
  }

  if (localClaimLocks.has(key)) {
    return { ok: true, replayed: true }
  }

  const kv = (env as any).INBOX_KV
  localClaimLocks.add(key)
  try {
    const existing = await kv.get(key)
    if (existing) {
      return { ok: true, replayed: true }
    }
    await kv.put(key, '1', { expirationTtl: ttl })
    return { ok: true, replayed: false }
  } catch {
    return { ok: false, code: 'replay_store_error' }
  } finally {
    localClaimLocks.delete(key)
  }
}
