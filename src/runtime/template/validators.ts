import { validateCreatePaymentIntentPayload } from '../payments/validators.js'

type ValidateResult = { ok: true } | { ok: false; error: string }

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function hasStr(v: Record<string, unknown>, key: string): boolean {
  return typeof v[key] === 'string' && (v[key] as string).trim().length > 0
}

export function validateResolveRoute(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'path')) return { ok: false, error: 'payload.path is required' }
  if (!hasStr(payload, 'siteId') && !hasStr(payload, 'host')) {
    return { ok: false, error: 'payload.siteId or payload.host is required' }
  }
  return { ok: true }
}

export function validateGetPage(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'siteId')) return { ok: false, error: 'payload.siteId is required' }
  if (!hasStr(payload, 'slug') && !hasStr(payload, 'pageId')) {
    return { ok: false, error: 'payload.slug or payload.pageId is required' }
  }
  return { ok: true }
}

export function validateSiteByHost(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'host')) return { ok: false, error: 'payload.host is required' }
  return { ok: true }
}

export function validateCreateOrder(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'siteId')) return { ok: false, error: 'payload.siteId is required' }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, error: 'payload.items must be a non-empty array' }
  }
  return { ok: true }
}

export function validateCreatePaymentIntent(payload: unknown): ValidateResult {
  return validateCreatePaymentIntentPayload(payload)
}
