import { isSupportedPaymentProvider } from './providers.js'

type ValidateResult = { ok: true } | { ok: false; error: string }

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function hasStr(v: Record<string, unknown>, key: string): boolean {
  return typeof v[key] === 'string' && (v[key] as string).trim().length > 0
}

export function validateCreatePaymentIntentPayload(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'orderId')) return { ok: false, error: 'payload.orderId is required' }
  if (!hasStr(payload, 'provider')) return { ok: false, error: 'payload.provider is required' }
  const provider = String(payload.provider)
  if (provider.trim() !== provider || !isSupportedPaymentProvider(provider)) {
    return { ok: false, error: 'payload.provider must be stripe|paypal|gopay' }
  }
  return { ok: true }
}
