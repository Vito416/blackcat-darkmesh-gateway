import { inc, gauge } from './metrics.js'
import crypto from 'crypto'
import { safeCompareHexOrAscii } from './runtime/crypto/safeCompare.js'
import { loadIntegerConfig, loadStringConfig } from './runtime/config/loader.js'

const DEFAULT_CERT_TTL_MS = 6 * 60 * 60 * 1000
const MIN_CERT_TTL_MS = 60 * 1000
const MAX_CERT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_CERT_CACHE_MAX = 256
const MIN_CERT_CACHE_MAX = 1
const MAX_CERT_CACHE_MAX = 4096
const MAX_CERT_URL_BYTES = 2048
const DEFAULT_STRIPE_SIGNATURE_HEADER_BYTES = 4096
const MIN_STRIPE_SIGNATURE_HEADER_BYTES = 256
const MAX_STRIPE_SIGNATURE_HEADER_BYTES = 16384
const MAX_STRIPE_SIGNATURE_PARTS = 32
const DEFAULT_PAYPAL_HTTP_TIMEOUT_MS = 7000
const MIN_PAYPAL_HTTP_TIMEOUT_MS = 1000
const MAX_PAYPAL_HTTP_TIMEOUT_MS = 60000

function readStringEnv(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok) return undefined
  const value = typeof loaded.value === 'string' ? loaded.value.trim() : ''
  return value.length > 0 ? value : undefined
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
  if (!loaded.ok) return fallback
  if (!Number.isFinite(loaded.value)) return fallback
  return Math.min(Math.max(Math.floor(loaded.value), min), max)
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

function isValidCertUrl(rawUrl?: string): rawUrl is string {
  if (!rawUrl) return false
  const url = rawUrl.trim()
  if (!url || url.length > MAX_CERT_URL_BYTES) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    return true
  } catch {
    return false
  }
}

function parsePaypalApiAllowHosts(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

function resolvePaypalApiBase(): URL | null {
  const rawBase = readStringEnv('PAYPAL_API_BASE') || 'https://api-m.sandbox.paypal.com'
  try {
    const base = new URL(rawBase)
    if (base.protocol !== 'https:') return null
    if (base.username || base.password) return null
    const allowHosts = parsePaypalApiAllowHosts(readStringEnv('PAYPAL_API_ALLOW_HOSTS'))
    if (allowHosts.length > 0 && !allowHosts.includes(base.hostname.toLowerCase())) return null
    return base
  } catch {
    return null
  }
}

function getPaypalHttpTimeoutMs(): number {
  return readBoundedIntEnv(
    'PAYPAL_HTTP_TIMEOUT_MS',
    DEFAULT_PAYPAL_HTTP_TIMEOUT_MS,
    MIN_PAYPAL_HTTP_TIMEOUT_MS,
    MAX_PAYPAL_HTTP_TIMEOUT_MS,
  )
}

function parseStripeSignatureHeader(sigHeader: string): { timestamp: string | null; signatures: string[] } | null {
  const header = sigHeader.trim()
  if (!header || header.length > STRIPE_SIGNATURE_HEADER_MAX_BYTES) return null
  const buckets: Record<string, string[]> = {}
  let seenParts = 0
  for (const rawPart of header.split(',')) {
    seenParts = seenParts + 1
    if (seenParts > MAX_STRIPE_SIGNATURE_PARTS) return null
    const part = rawPart.trim()
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!key || !value) continue
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(value)
  }
  const ts = buckets.t && buckets.t.length > 0 ? buckets.t[buckets.t.length - 1] : null
  return { timestamp: ts, signatures: buckets.v1 || [] }
}

// Stripe webhook verification (t=timestamp,v1=signature)
export function verifyStripe(body: string, sigHeader: string | null, secret: string, toleranceMs: number): boolean {
  if (!body || !sigHeader || !secret) return false
  const parsed = parseStripeSignatureHeader(sigHeader)
  if (!parsed) return false
  if (!parsed.timestamp || parsed.signatures.length === 0) return false
  const ts = Number.parseInt(parsed.timestamp, 10)
  if (!Number.isFinite(ts)) return false
  const tol = Number.isFinite(toleranceMs) ? toleranceMs : 300000
  if (Math.abs(Date.now() - (ts * 1000)) > tol) return false
  const signedPayload = `${parsed.timestamp}.${body}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return parsed.signatures.some((candidate) => safeCompareHexOrAscii(expected, candidate))
}

// PayPal webhook verification (HMAC fallback + RSA remote)
export async function verifyPayPal(body: string, headers: Headers, secret?: string): Promise<boolean> {
  if (!body) return false
  const parsedBody = parsePayPalBody(body)
  if (!parsedBody) return false
  // HMAC short-path if secret provided
  if (secret) {
    const sig = headers.get('PayPal-Transmission-Sig') || headers.get('PP-Signature')
    if (!sig) return false
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    if (safeCompareHexOrAscii(expected, sig.trim())) return true
  }
  const certUrl = headers.get('PayPal-Cert-Url')
  if (!isValidCertUrl(certUrl || undefined)) return false
  // Remote verify (requires PAYPAL_WEBHOOK_ID and client creds via env)
  const webhookId = readStringEnv('PAYPAL_WEBHOOK_ID')
  if (!webhookId) return false
  const base = resolvePaypalApiBase()
  if (!base) return false
  const timeoutMs = getPaypalHttpTimeoutMs()
  const token = await paypalToken(base, timeoutMs)
  if (!token) return false
  try {
    const payload = {
      auth_algo: headers.get('PayPal-Auth-Algo'),
      cert_url: certUrl,
      transmission_id: headers.get('PayPal-Transmission-Id'),
      transmission_sig: headers.get('PayPal-Transmission-Sig') || headers.get('PayPal-Transmission-Signature'),
      transmission_time: headers.get('PayPal-Transmission-Time'),
      webhook_id: webhookId,
      webhook_event: parsedBody,
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let resp: Response
    try {
      resp = await fetch(`${base.toString()}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
    if (!resp.ok) return false
    const data = await resp.json()
    return Boolean(data && data.verification_status === 'SUCCESS')
  } catch {
    return false
  }
}

async function paypalToken(base: URL, timeoutMs: number): Promise<string | null> {
  const cid = readStringEnv('PAYPAL_CLIENT_ID')
  const sec = readStringEnv('PAYPAL_CLIENT_SECRET')
  if (!cid || !sec) return null
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const resp = await fetch(`${base.toString()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cid}:${sec}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return data.access_token || null
  } catch (error) {
    if (timedOut || isAbortError(error)) return null
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Simple cert cache placeholder (for future pinning)
const certCache = new Map<string, number>()
const CERT_TTL = readBoundedIntEnv('GW_CERT_CACHE_TTL_MS', DEFAULT_CERT_TTL_MS, MIN_CERT_TTL_MS, MAX_CERT_TTL_MS)
const CERT_CACHE_MAX = readBoundedIntEnv('GW_CERT_CACHE_MAX_SIZE', DEFAULT_CERT_CACHE_MAX, MIN_CERT_CACHE_MAX, MAX_CERT_CACHE_MAX)
const STRIPE_SIGNATURE_HEADER_MAX_BYTES = readBoundedIntEnv(
  'GW_STRIPE_SIGNATURE_HEADER_MAX_BYTES',
  DEFAULT_STRIPE_SIGNATURE_HEADER_BYTES,
  MIN_STRIPE_SIGNATURE_HEADER_BYTES,
  MAX_STRIPE_SIGNATURE_HEADER_BYTES,
)
const CERT_ALLOW_PREFIXES = (readStringEnv('PAYPAL_CERT_ALLOW_PREFIXES') || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
const CERT_PIN_SHA256 = (readStringEnv('GW_CERT_PIN_SHA256') || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

function sweepCerts(now: number) {
  let removed = 0
  for (const [u, exp] of certCache.entries()) {
    if (exp <= now) { certCache.delete(u); removed = removed + 1 }
  }
  if (removed > 0) gauge('gateway_webhook_cert_cache_size', certCache.size)
}

function trimCertCache() {
  while (certCache.size >= CERT_CACHE_MAX) {
    const oldest = certCache.keys().next()
    if (oldest.done) break
    certCache.delete(oldest.value)
  }
}

function certAllowed(url: string): boolean {
  if (CERT_ALLOW_PREFIXES.length === 0) return true
  return CERT_ALLOW_PREFIXES.some((p) => url.startsWith(p))
}

function certPinnedOk(fingerprint?: string): boolean {
  if (CERT_PIN_SHA256.length === 0) return true
  if (!fingerprint) return false
  return CERT_PIN_SHA256.includes(fingerprint)
}

export function noteCert(url?: string, fingerprint?: string): boolean {
  if (!url) return true
  if (!isValidCertUrl(url)) {
    inc('gateway_webhook_cert_allow_fail')
    return false
  }
  const now = Date.now()
  sweepCerts(now)
  if (!certAllowed(url)) {
    inc('gateway_webhook_cert_allow_fail')
    return false
  }
  if (!certPinnedOk(fingerprint)) {
    inc('gateway_webhook_cert_pin_fail')
    return false
  }
  if (certCache.has(url)) certCache.delete(url)
  trimCertCache()
  certCache.set(url, now + CERT_TTL)
  inc('gateway_webhook_cert_seen')
  gauge('gateway_webhook_cert_cache_size', certCache.size)
  return true
}

function parsePayPalBody(body: string): object | null {
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}
