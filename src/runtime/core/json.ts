import { utf8ByteLength } from './bytes.js'

export type JsonParseErrorCode =
  | 'json_invalid_limit'
  | 'json_body_too_large'
  | 'json_invalid_syntax'
  | 'json_not_object'
  | 'json_not_array'

export type JsonParseFailure = {
  ok: false
  code: JsonParseErrorCode
  message: string
  limitBytes?: number
  actualBytes?: number
}

export type JsonParseSuccess<T> = {
  ok: true
  value: T
}

export type JsonParseResult<T> = JsonParseSuccess<T> | JsonParseFailure

export type JsonBodyKind = 'object' | 'array'

function makeFailure(
  code: JsonParseErrorCode,
  message: string,
  details?: { limitBytes?: number; actualBytes?: number },
): JsonParseFailure {
  return {
    ok: false,
    code,
    message,
    ...(details?.limitBytes === undefined ? {} : { limitBytes: details.limitBytes }),
    ...(details?.actualBytes === undefined ? {} : { actualBytes: details.actualBytes }),
  }
}

function parseJsonText(raw: string): JsonParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch (error) {
    return makeFailure(
      'json_invalid_syntax',
      error instanceof Error && error.message ? error.message : 'invalid json text',
    )
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function parseJsonBodyWithLimit<T>(
  raw: string,
  limitBytes: number,
  kind: JsonBodyKind,
): JsonParseResult<T> {
  if (!Number.isFinite(limitBytes) || !Number.isInteger(limitBytes) || limitBytes < 0) {
    return makeFailure('json_invalid_limit', 'limitBytes must be a non-negative integer')
  }

  const actualBytes = utf8ByteLength(raw)
  if (actualBytes > limitBytes) {
    return makeFailure('json_body_too_large', 'json body exceeds the configured byte limit', {
      limitBytes,
      actualBytes,
    })
  }

  const parsed = parseJsonText(raw)
  if (!parsed.ok) return parsed

  if (kind === 'object') {
    if (!isObject(parsed.value)) {
      return makeFailure('json_not_object', 'json value must be an object')
    }
    return { ok: true, value: parsed.value as T }
  }

  if (!isArray(parsed.value)) {
    return makeFailure('json_not_array', 'json value must be an array')
  }

  return { ok: true, value: parsed.value as T }
}

export function parseJsonObject(raw: string): JsonParseResult<Record<string, unknown>> {
  const parsed = parseJsonText(raw)
  if (!parsed.ok) return parsed
  if (!isObject(parsed.value)) {
    return makeFailure('json_not_object', 'json value must be an object')
  }
  return { ok: true, value: parsed.value }
}

export function parseJsonArray(raw: string): JsonParseResult<unknown[]> {
  const parsed = parseJsonText(raw)
  if (!parsed.ok) return parsed
  if (!isArray(parsed.value)) {
    return makeFailure('json_not_array', 'json value must be an array')
  }
  return { ok: true, value: parsed.value }
}

export function parseJsonObjectBody(raw: string, limitBytes: number): JsonParseResult<Record<string, unknown>> {
  return parseJsonBodyWithLimit<Record<string, unknown>>(raw, limitBytes, 'object')
}

export function parseJsonArrayBody(raw: string, limitBytes: number): JsonParseResult<unknown[]> {
  return parseJsonBodyWithLimit<unknown[]>(raw, limitBytes, 'array')
}
