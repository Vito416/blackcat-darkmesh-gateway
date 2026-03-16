import { inc, gauge } from './metrics'
import crypto from 'crypto'

// Stripe webhook verification (t=timestamp,v1=signature)
export function verifyStripe(body: string, sigHeader: string | null, secret: string, toleranceMs: number): boolean {
  if (!body || !sigHeader || !secret) return false
  const parts: Record<string, string> = {}
  sigHeader.split(',').forEach((p) => {
    const [k, v] = p.split('='); if (k && v) parts[k.trim()] = v.trim()
  })
  if (!parts.t || !parts.v1) return false
  const signedPayload = `${parts.t}.${body}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  if (expected !== parts.v1) return false
  const tol = isNaN(toleranceMs) ? 300000 : toleranceMs
  const ts = parseInt(parts.t, 10) * 1000
  if (isFinite(ts) && Math.abs(Date.now() - ts) > tol) return false
  return true
}

// PayPal webhook verification (HMAC fallback + RSA remote)
export async function verifyPayPal(body: string, headers: Headers, secret?: string): Promise<boolean> {
  if (!body) return false
  // HMAC short-path if secret provided
  if (secret) {
    const sig = headers.get('PayPal-Transmission-Sig') || headers.get('PP-Signature')
    if (!sig) return false
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    if (expected === sig) return true
  }
  // Remote verify (requires PAYPAL_WEBHOOK_ID and client creds via env)
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (!webhookId) return false
  const token = await paypalToken()
  if (!token) return false
  const payload = {
    auth_algo: headers.get('PayPal-Auth-Algo'),
    cert_url: headers.get('PayPal-Cert-Url'),
    transmission_id: headers.get('PayPal-Transmission-Id'),
    transmission_sig: headers.get('PayPal-Transmission-Sig') || headers.get('PayPal-Transmission-Signature'),
    transmission_time: headers.get('PayPal-Transmission-Time'),
    webhook_id: webhookId,
    webhook_event: JSON.parse(body),
  }
  const resp = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) return false
  const data = await resp.json()
  return data && data.verification_status === 'SUCCESS'
}

async function paypalToken(): Promise<string | null> {
  const cid = process.env.PAYPAL_CLIENT_ID
  const sec = process.env.PAYPAL_CLIENT_SECRET
  if (!cid || !sec) return null
  const base = paypalBase()
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${cid}:${sec}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!resp.ok) return null
  const data = await resp.json()
  return data.access_token || null
}

function paypalBase() {
  return process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'
}

// Simple cert cache placeholder (for future pinning)
const certCache = new Map<string, number>()
const CERT_TTL = parseInt(process.env.GW_CERT_CACHE_TTL_MS || '21600000', 10) // 6h
const CERT_ALLOW_PREFIXES = (process.env.PAYPAL_CERT_ALLOW_PREFIXES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
const CERT_PIN_SHA256 = (process.env.GW_CERT_PIN_SHA256 || '')
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
  sweepCerts(Date.now())
  if (!certAllowed(url)) {
    inc('gateway_webhook_cert_allow_fail')
    return false
  }
  if (!certPinnedOk(fingerprint)) {
    inc('gateway_webhook_cert_pin_fail')
    return false
  }
  certCache.set(url, Date.now() + CERT_TTL)
  inc('gateway_webhook_cert_seen')
  gauge('gateway_webhook_cert_cache_size', certCache.size)
  return true
}
