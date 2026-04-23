import { HTTPException } from 'hono/http-exception'
import { Buffer } from 'node:buffer'
import * as ed25519 from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import type { Env } from './types'
import { inc } from './metrics'

ed25519.etc.sha512Sync = (msg) => sha512(msg)

const DEFAULT_ROUTE_ASSERT_TTL_SEC = 120
const MAX_ROUTE_ASSERT_TTL_SEC = 300
const ROUTE_ASSERT_VERSION = 'dm-route-assert/1'

type RouteAssertInput = {
  domain?: unknown
  cfgTx?: unknown
  hbHost?: unknown
  challengeNonce?: unknown
  challengeExp?: unknown
}

type RouteAssertion = {
  v: string
  iat: number
  exp: number
  challengeNonce: string
  challengeExp: number
  domain: string
  cfgTx: string
  hbHost: string
  siteProcess?: string
  writeProcess?: string
  entryPath?: string
}

function cleanEnv(value?: string | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDomainLike(value: string, fieldName: string) {
  let normalized = value.trim().toLowerCase()
  if (!normalized) throw new HTTPException(400, { message: `missing_${fieldName}` })
  if (normalized.includes('://')) {
    throw new HTTPException(400, { message: `invalid_${fieldName}` })
  }
  normalized = normalized.replace(/\.+$/, '')
  if (!normalized) throw new HTTPException(400, { message: `invalid_${fieldName}` })
  if (normalized.length > 253 || normalized.includes('/')) {
    throw new HTTPException(400, { message: `invalid_${fieldName}` })
  }

  let parsedHost = normalized
  try {
    parsedHost = new URL(`http://${normalized}`).hostname.toLowerCase()
  } catch {
    throw new HTTPException(400, { message: `invalid_${fieldName}` })
  }

  if (!parsedHost.includes('.')) {
    throw new HTTPException(400, { message: `invalid_${fieldName}` })
  }

  for (const label of parsedHost.split('.')) {
    if (!label || label.length > 63) {
      throw new HTTPException(400, { message: `invalid_${fieldName}` })
    }
    if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-')) {
      throw new HTTPException(400, { message: `invalid_${fieldName}` })
    }
  }
  return parsedHost
}

function readRequiredString(value: unknown, fieldName: string) {
  if (typeof value !== 'string') {
    throw new HTTPException(400, { message: `missing_${fieldName}` })
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new HTTPException(400, { message: `missing_${fieldName}` })
  }
  return normalized
}

function parseChallengeExp(value: unknown) {
  let numeric: number
  if (typeof value === 'number') {
    numeric = value
  } else if (typeof value === 'string') {
    numeric = Number.parseInt(value.trim(), 10)
  } else {
    throw new HTTPException(400, { message: 'missing_challengeExp' })
  }
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new HTTPException(400, { message: 'invalid_challengeExp' })
  }
  return Math.trunc(numeric)
}

function routeAssertTtl(env: Env) {
  const configured = Number.parseInt(cleanEnv(env.ROUTE_ASSERT_TTL_SEC) || `${DEFAULT_ROUTE_ASSERT_TTL_SEC}`, 10)
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_ROUTE_ASSERT_TTL_SEC
  return Math.min(MAX_ROUTE_ASSERT_TTL_SEC, Math.max(10, Math.trunc(configured)))
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function parsePrivateKeyHex(value: string): Uint8Array {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new HTTPException(500, { message: 'invalid_route_assert_signing_key' })
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < value.length; i += 2) {
    out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16)
  }
  return out
}

function readBearerToken(c: any) {
  const authHeader = c.req.header('authorization') || c.req.header('Authorization') || ''
  if (!/^Bearer\s+/i.test(authHeader)) return ''
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

function requireRouteAssertToken(c: any) {
  const expected = cleanEnv(c.env.ROUTE_ASSERT_TOKEN)
  if (!expected) {
    inc('worker_route_assert_fail_total')
    throw new HTTPException(500, { message: 'missing_route_assert_token' })
  }
  const actual = readBearerToken(c)
  if (!actual || actual !== expected) {
    inc('worker_route_assert_auth_failed_total')
    throw new HTTPException(401, { message: 'unauthorized' })
  }
}

function optionalValue(value?: string | null) {
  const normalized = cleanEnv(value)
  return normalized || undefined
}

export async function handleRouteAssert(c: any) {
  requireRouteAssertToken(c)

  let body: RouteAssertInput
  try {
    body = await c.req.json<RouteAssertInput>()
  } catch {
    inc('worker_route_assert_reject_total')
    throw new HTTPException(400, { message: 'invalid_json' })
  }

  const domain = normalizeDomainLike(readRequiredString(body.domain, 'domain'), 'domain')
  const cfgTx = readRequiredString(body.cfgTx, 'cfgTx')
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(cfgTx)) {
    inc('worker_route_assert_reject_total')
    throw new HTTPException(400, { message: 'invalid_cfgTx' })
  }
  const hbHost = normalizeDomainLike(readRequiredString(body.hbHost, 'hbHost'), 'hbHost')
  const challengeNonce = readRequiredString(body.challengeNonce, 'challengeNonce')
  if (!/^[A-Za-z0-9._:-]{8,256}$/.test(challengeNonce)) {
    inc('worker_route_assert_reject_total')
    throw new HTTPException(400, { message: 'invalid_challengeNonce' })
  }
  const challengeExp = parseChallengeExp(body.challengeExp)

  const now = Math.floor(Date.now() / 1000)
  if (challengeExp <= now) {
    inc('worker_route_assert_reject_total')
    throw new HTTPException(400, { message: 'challenge_expired' })
  }

  const ttl = routeAssertTtl(c.env as Env)
  const exp = Math.min(challengeExp, now + ttl)
  if (exp <= now) {
    inc('worker_route_assert_reject_total')
    throw new HTTPException(400, { message: 'invalid_assertion_ttl' })
  }

  const assertion: RouteAssertion = {
    v: ROUTE_ASSERT_VERSION,
    iat: now,
    exp,
    challengeNonce,
    challengeExp,
    domain,
    cfgTx,
    hbHost,
  }

  const siteProcess = optionalValue(c.env.ROUTE_ASSERT_SITE_PROCESS || c.env.AO_SITE_PROCESS_ID)
  const writeProcess = optionalValue(c.env.ROUTE_ASSERT_WRITE_PROCESS || c.env.WRITE_PROCESS_ID)
  const entryPath = optionalValue(c.env.ROUTE_ASSERT_ENTRY_PATH) || '/'
  if (siteProcess) assertion.siteProcess = siteProcess
  if (writeProcess) assertion.writeProcess = writeProcess
  if (entryPath) assertion.entryPath = entryPath

  const privateKeyHex = cleanEnv(c.env.ROUTE_ASSERT_SIGNING_KEY_HEX || c.env.WORKER_ED25519_PRIV_HEX)
  if (!privateKeyHex) {
    inc('worker_route_assert_fail_total')
    throw new HTTPException(500, { message: 'missing_route_assert_signing_key' })
  }

  const privateKey = parsePrivateKeyHex(privateKeyHex)
  const signingPayload = stableStringify(assertion)
  const signatureBytes = await ed25519.sign(Buffer.from(signingPayload), privateKey)
  const signature = Buffer.from(signatureBytes).toString('hex')
  const signatureRef = cleanEnv(c.env.ROUTE_ASSERT_SIGNATURE_REF || c.env.WORKER_SIGNATURE_REF) || 'worker-ed25519'

  inc('worker_route_assert_ok_total')
  return c.json({
    ok: true,
    assertion,
    signature,
    sigAlg: 'ed25519',
    signatureRef,
  })
}
