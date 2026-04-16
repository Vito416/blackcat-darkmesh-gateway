export const ANALYTICS_EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/
export const DEFAULT_ANALYTICS_KEY_MAX_LENGTH = 64
export const DEFAULT_ANALYTICS_VALUE_MAX_LENGTH = 256

export type AnalyticsPrimitive = string | number | boolean | null
export type AnalyticsFields = Record<string, AnalyticsPrimitive>

export interface AnalyticsEventNormalizationOptions {
  now?: number | (() => number)
  maxFieldKeyLength?: number
  maxFieldValueLength?: number
}

export interface NormalizedAnalyticsEvent {
  name: string
  timestamp: string
  tags: AnalyticsFields
  metadata: AnalyticsFields
}

export type AnalyticsEventParseResult =
  | { ok: true; value: NormalizedAnalyticsEvent }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (numeric < min) return min
  if (numeric > max) return max
  return numeric
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function safeStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : null
  } catch {
    return null
  }
}

function normalizeFieldValue(value: unknown, maxValueLength: number): AnalyticsPrimitive {
  if (value === null) return null
  if (typeof value === 'string') return truncate(value, maxValueLength)
  if (typeof value === 'number') return Number.isFinite(value) ? value : truncate(String(value), maxValueLength)
  if (typeof value === 'boolean') return value
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) ? value.toISOString() : null
  }
  if (typeof value === 'bigint') return truncate(value.toString(), maxValueLength)
  const serialized = safeStringify(value)
  if (serialized !== null) return truncate(serialized, maxValueLength)
  return truncate(String(value), maxValueLength)
}

function resolveNow(now: number | (() => number) | undefined): number {
  if (typeof now === 'function') {
    const computed = now()
    if (typeof computed === 'number' && Number.isFinite(computed)) return computed
  }
  if (typeof now === 'number' && Number.isFinite(now)) return now
  return Date.now()
}

function normalizeTimestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function resolveEventName(payload: Record<string, unknown>): string | null {
  const candidate =
    typeof payload.event === 'string'
      ? payload.event
      : typeof payload.name === 'string'
        ? payload.name
        : null
  if (!candidate) return null
  const trimmed = candidate.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isValidAnalyticsEventName(name: string): boolean {
  return ANALYTICS_EVENT_NAME_PATTERN.test(name)
}

export function normalizeAnalyticsTimestamp(value: unknown, now?: number | (() => number)): string {
  const parsedMillis = normalizeTimestampMillis(value)
  const millis = parsedMillis === null ? resolveNow(now) : parsedMillis
  return new Date(millis).toISOString()
}

export function normalizeAnalyticsFields(
  input: unknown,
  options: Pick<AnalyticsEventNormalizationOptions, 'maxFieldKeyLength' | 'maxFieldValueLength'> = {},
): AnalyticsFields {
  if (!isRecord(input)) return {}

  const maxKeyLength = clampInteger(options.maxFieldKeyLength, DEFAULT_ANALYTICS_KEY_MAX_LENGTH, 1, 256)
  const maxValueLength = clampInteger(options.maxFieldValueLength, DEFAULT_ANALYTICS_VALUE_MAX_LENGTH, 1, 4096)

  const normalized: AnalyticsFields = {}
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = truncate(rawKey.trim(), maxKeyLength)
    if (!key) continue
    normalized[key] = normalizeFieldValue(rawValue, maxValueLength)
  }
  return normalized
}

export function parseAnalyticsEventEnvelope(
  payload: unknown,
  options: AnalyticsEventNormalizationOptions = {},
): AnalyticsEventParseResult {
  if (!isRecord(payload)) return { ok: false, error: 'payload must be an object' }

  const name = resolveEventName(payload)
  if (!name) return { ok: false, error: 'event name is required' }
  if (!isValidAnalyticsEventName(name)) {
    return { ok: false, error: 'event name must be lowercase and use [a-z0-9._:-]' }
  }

  const timestampSource =
    payload.timestamp !== undefined
      ? payload.timestamp
      : payload.ts !== undefined
        ? payload.ts
        : payload.time

  return {
    ok: true,
    value: {
      name,
      timestamp: normalizeAnalyticsTimestamp(timestampSource, options.now),
      tags: normalizeAnalyticsFields(payload.tags, options),
      metadata: normalizeAnalyticsFields(payload.metadata, options),
    },
  }
}
