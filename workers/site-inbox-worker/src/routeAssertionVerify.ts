import { Buffer } from 'node:buffer'
import * as ed25519 from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import type { Env } from './types'
import { inc } from './metrics'
import { claimRouteAssertionReplay } from './routeAssertionReplay'

ed25519.etc.sha512Sync = (msg) => sha512(msg)

const DEFAULT_VERIFY_SKEW_SEC = 30
const ROUTE_ASSERT_VERSION = 'dm-route-assert/1'

type VerifyInput = {
  assertion?: unknown
  signature?: unknown
  sigAlg?: unknown
  signatureRef?: unknown
  expectedDomain?: unknown
  expectedHbHost?: unknown
}

type AssertionRecord = {
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

const encoder = new TextEncoder()

function cleanEnv(value?: string | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDomainLike(value: string, fieldName: string) {
  let normalized = value.trim().toLowerCase()
  if (!normalized || normalized.includes('://')) {
    throw new Error(`invalid_${fieldName}`)
  }
  normalized = normalized.replace(/\.+$/, '')
  if (!normalized || normalized.length > 253 || normalized.includes('/')) {
    throw new Error(`invalid_${fieldName}`)
  }

  let parsedHost = normalized
  try {
    parsedHost = new URL(`http://${normalized}`).hostname.toLowerCase()
  } catch {
    throw new Error(`invalid_${fieldName}`)
  }

  if (!parsedHost.includes('.')) {
    throw new Error(`invalid_${fieldName}`)
  }
  for (const label of parsedHost.split('.')) {
    if (!label || label.length > 63) throw new Error(`invalid_${fieldName}`)
    if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-')) {
      throw new Error(`invalid_${fieldName}`)
    }
  }
  return parsedHost
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

function readHex(bytesHex: string, expectedBytes: number, errorCode: string): Uint8Array {
  if (!new RegExp(`^[a-fA-F0-9]{${expectedBytes * 2}}$`).test(bytesHex)) {
    throw new Error(errorCode)
  }
  const bytes = new Uint8Array(expectedBytes)
  for (let i = 0; i < bytesHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(bytesHex.slice(i, i + 2), 16)
  }
  return bytes
}

async function resolveVerifyPublicKey(env: Env): Promise<Uint8Array> {
  const pubHex = cleanEnv(env.ROUTE_ASSERT_VERIFY_PUB_HEX)
  if (pubHex) {
    return readHex(pubHex, 32, 'invalid_verify_pubkey')
  }
  const privateKeyHex = cleanEnv(env.ROUTE_ASSERT_SIGNING_KEY_HEX || env.WORKER_ED25519_PRIV_HEX)
  if (!privateKeyHex) {
    throw new Error('missing_verify_key')
  }
  const privateKey = readHex(privateKeyHex, 32, 'invalid_verify_privkey')
  return ed25519.getPublicKeyAsync(privateKey)
}

function parseVerifyInput(raw: VerifyInput): AssertionRecord {
  if (!raw || typeof raw !== 'object' || !raw.assertion || typeof raw.assertion !== 'object' || Array.isArray(raw.assertion)) {
    throw new Error('bad_shape')
  }
  const assertion = raw.assertion as Record<string, unknown>
  const requireString = (key: keyof AssertionRecord) => {
    const value = assertion[key]
    if (typeof value !== 'string' || !value.trim()) throw new Error('bad_shape')
    return value.trim()
  }
  const requireNumber = (key: keyof AssertionRecord) => {
    const value = assertion[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('bad_shape')
    return Math.trunc(value)
  }

  const parsed: AssertionRecord = {
    v: requireString('v'),
    iat: requireNumber('iat'),
    exp: requireNumber('exp'),
    challengeNonce: requireString('challengeNonce'),
    challengeExp: requireNumber('challengeExp'),
    domain: normalizeDomainLike(requireString('domain'), 'domain'),
    cfgTx: requireString('cfgTx'),
    hbHost: normalizeDomainLike(requireString('hbHost'), 'hbHost'),
  }
  if (assertion.siteProcess && typeof assertion.siteProcess === 'string') parsed.siteProcess = assertion.siteProcess
  if (assertion.writeProcess && typeof assertion.writeProcess === 'string') parsed.writeProcess = assertion.writeProcess
  if (assertion.entryPath && typeof assertion.entryPath === 'string') parsed.entryPath = assertion.entryPath
  return parsed
}

function verifyWindow(assertion: AssertionRecord, env: Env) {
  const now = Math.floor(Date.now() / 1000)
  if (assertion.v !== ROUTE_ASSERT_VERSION) return 'bad_shape'
  if (assertion.exp <= assertion.iat) return 'bad_shape'
  if (assertion.challengeExp < assertion.exp) return 'bad_shape'
  if (assertion.exp <= now) return 'expired_assertion'
  const skew = Number.parseInt(cleanEnv(env.ROUTE_ASSERT_VERIFY_SKEW_SEC) || `${DEFAULT_VERIFY_SKEW_SEC}`, 10)
  const allowedSkew = Number.isFinite(skew) && skew >= 0 ? Math.trunc(skew) : DEFAULT_VERIFY_SKEW_SEC
  if (assertion.iat > now + allowedSkew) return 'assertion_not_yet_valid'
  return null
}

async function payloadHashHex(payload: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload))
  return Buffer.from(new Uint8Array(digest)).toString('hex')
}

function fail(c: any, status: number, code: string) {
  inc('worker_route_assert_verify_fail_total')
  return c.json({ ok: false, error: code }, status)
}

export async function handleRouteAssertVerify(c: any) {
  let body: VerifyInput
  try {
    body = await c.req.json<VerifyInput>()
  } catch {
    return fail(c, 400, 'bad_shape')
  }

  const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
  const sigAlg = typeof body.sigAlg === 'string' ? body.sigAlg.trim().toLowerCase() : ''
  const signatureRef = typeof body.signatureRef === 'string' ? body.signatureRef.trim() : ''
  if (!signature || !sigAlg || !signatureRef) {
    return fail(c, 400, 'bad_shape')
  }
  if (sigAlg !== 'ed25519') {
    return fail(c, 400, 'unsupported_sigalg')
  }
  const expectedSigRef = cleanEnv(c.env.ROUTE_ASSERT_SIGNATURE_REF || c.env.WORKER_SIGNATURE_REF)
  if (expectedSigRef && signatureRef !== expectedSigRef) {
    return fail(c, 409, 'signature_ref_mismatch')
  }

  let assertion: AssertionRecord
  try {
    assertion = parseVerifyInput(body)
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : 'bad_shape')
  }

  const windowError = verifyWindow(assertion, c.env as Env)
  if (windowError) {
    return fail(c, 409, windowError)
  }

  if (typeof body.expectedDomain === 'string' && body.expectedDomain.trim()) {
    let expectedDomain = ''
    try {
      expectedDomain = normalizeDomainLike(body.expectedDomain, 'expectedDomain')
    } catch {
      return fail(c, 400, 'bad_shape')
    }
    if (assertion.domain !== expectedDomain) {
      return fail(c, 409, 'domain_mismatch')
    }
  }
  if (typeof body.expectedHbHost === 'string' && body.expectedHbHost.trim()) {
    let expectedHbHost = ''
    try {
      expectedHbHost = normalizeDomainLike(body.expectedHbHost, 'expectedHbHost')
    } catch {
      return fail(c, 400, 'bad_shape')
    }
    if (assertion.hbHost !== expectedHbHost) {
      return fail(c, 409, 'hbhost_mismatch')
    }
  }

  let verifyKey: Uint8Array
  try {
    verifyKey = await resolveVerifyPublicKey(c.env as Env)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'missing_verify_key'
    return fail(c, 500, code)
  }

  let signatureBytes: Uint8Array
  try {
    signatureBytes = readHex(signature, 64, 'invalid_sig')
  } catch {
    return fail(c, 401, 'invalid_sig')
  }

  const canonicalPayload = stableStringify(assertion)
  const isValid = await ed25519.verify(signatureBytes, Buffer.from(canonicalPayload), verifyKey)
  if (!isValid) {
    return fail(c, 401, 'invalid_sig')
  }

  const replayClaim = await claimRouteAssertionReplay(c.env as Env, assertion)
  if (!replayClaim.ok) {
    return fail(c, 500, replayClaim.code)
  }
  if (replayClaim.replayed) {
    return fail(c, 409, 'replay_detected')
  }

  const hash = await payloadHashHex(canonicalPayload)
  inc('worker_route_assert_verify_ok_total')
  return c.json({
    ok: true,
    verified: true,
    assertionHash: hash,
  })
}
