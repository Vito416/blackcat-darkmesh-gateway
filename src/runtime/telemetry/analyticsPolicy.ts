import {
  type AnalyticsEventNormalizationOptions,
  type NormalizedAnalyticsEvent,
  parseAnalyticsEventEnvelope,
} from './analyticsEvent.js'

export const DEFAULT_ANALYTICS_MAX_EVENT_BYTES = 8 * 1024
export const DEFAULT_ANALYTICS_MAX_TAGS = 24
export const DEFAULT_ANALYTICS_SENSITIVE_KEYS = [
  'password',
  'passwd',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'auth',
  'authorization',
  'proxy-authorization',
  'x-auth-token',
  'x-auth-header',
  'api-key',
  'x-api-key',
  'cookie',
  'set-cookie',
] as const

export interface AnalyticsValidationOptions extends AnalyticsEventNormalizationOptions {
  maxEventBytes?: number
  maxTags?: number
  denylistKeys?: string[]
}

export type AnalyticsValidationResult =
  | { ok: true; value: NormalizedAnalyticsEvent }
  | { ok: false; error: string }

const utf8 = new TextEncoder()

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (numeric < min) return min
  if (numeric > max) return max
  return numeric
}

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildSensitiveKeySet(extraKeys?: string[]): Set<string> {
  const keys = new Set<string>()
  for (const key of DEFAULT_ANALYTICS_SENSITIVE_KEYS) {
    keys.add(normalizeSensitiveKey(key))
  }
  if (!extraKeys) return keys
  for (const key of extraKeys) {
    if (typeof key !== 'string') continue
    const normalized = normalizeSensitiveKey(key)
    if (!normalized) continue
    keys.add(normalized)
  }
  return keys
}

function firstSensitiveKey(payload: Record<string, unknown>, denylist: Set<string>): string | null {
  for (const key of Object.keys(payload)) {
    if (denylist.has(normalizeSensitiveKey(key))) return key
  }
  return null
}

function estimateEventBytes(event: NormalizedAnalyticsEvent): number {
  return utf8.encode(JSON.stringify(event)).length
}

export function validateAnalyticsEvent(
  payload: unknown,
  options: AnalyticsValidationOptions = {},
): AnalyticsValidationResult {
  const parsed = parseAnalyticsEventEnvelope(payload, options)
  if (!parsed.ok) return parsed

  const maxTags = clampInteger(options.maxTags, DEFAULT_ANALYTICS_MAX_TAGS, 0, 256)
  const tagsCount = Object.keys(parsed.value.tags).length
  if (tagsCount > maxTags) {
    return { ok: false, error: `event tags exceed max tags (${tagsCount}/${maxTags})` }
  }

  const denylist = buildSensitiveKeySet(options.denylistKeys)
  const sensitiveTagKey = firstSensitiveKey(parsed.value.tags, denylist)
  if (sensitiveTagKey) {
    return { ok: false, error: `event tags contain sensitive key "${sensitiveTagKey}"` }
  }
  const sensitiveMetadataKey = firstSensitiveKey(parsed.value.metadata, denylist)
  if (sensitiveMetadataKey) {
    return { ok: false, error: `event metadata contain sensitive key "${sensitiveMetadataKey}"` }
  }

  const maxEventBytes = clampInteger(options.maxEventBytes, DEFAULT_ANALYTICS_MAX_EVENT_BYTES, 64, 1_048_576)
  const bytes = estimateEventBytes(parsed.value)
  if (bytes > maxEventBytes) {
    return { ok: false, error: `event exceeds max event size bytes (${bytes}/${maxEventBytes})` }
  }

  return parsed
}
