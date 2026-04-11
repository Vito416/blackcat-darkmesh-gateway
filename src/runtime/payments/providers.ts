export const SUPPORTED_PAYMENT_PROVIDERS = ['stripe', 'paypal', 'gopay'] as const

const SUPPORTED_PAYMENT_PROVIDER_SET = new Set<string>(SUPPORTED_PAYMENT_PROVIDERS)

export function normalizePaymentProvider(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

export function isSupportedPaymentProvider(value: unknown): boolean {
  const normalized = normalizePaymentProvider(value)
  return normalized !== null && SUPPORTED_PAYMENT_PROVIDER_SET.has(normalized)
}
