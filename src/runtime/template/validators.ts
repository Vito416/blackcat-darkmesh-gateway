type ValidateResult = { ok: true } | { ok: false; error: string }

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function hasStr(v: Record<string, unknown>, key: string): boolean {
  return typeof v[key] === 'string' && (v[key] as string).trim().length > 0
}

export function validateResolveRoute(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'host')) return { ok: false, error: 'payload.host is required' }
  if (!hasStr(payload, 'path')) return { ok: false, error: 'payload.path is required' }
  return { ok: true }
}

export function validateGetPage(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'siteId')) return { ok: false, error: 'payload.siteId is required' }
  if (!hasStr(payload, 'slug')) return { ok: false, error: 'payload.slug is required' }
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
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'orderId')) return { ok: false, error: 'payload.orderId is required' }
  if (!hasStr(payload, 'provider')) return { ok: false, error: 'payload.provider is required' }
  const provider = String(payload.provider).toLowerCase()
  if (!['stripe', 'paypal', 'gopay'].includes(provider)) {
    return { ok: false, error: 'payload.provider must be stripe|paypal|gopay' }
  }
  return { ok: true }
}
