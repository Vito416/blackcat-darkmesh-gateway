export type CanonicalJsonErrorCode =
  | 'canonical_json_cycle'
  | 'canonical_json_invalid_number'
  | 'canonical_json_invalid_type'
  | 'canonical_json_non_plain_object'
  | 'canonical_json_sparse_array'

export class CanonicalJsonError extends Error {
  code: CanonicalJsonErrorCode
  path: string

  constructor(code: CanonicalJsonErrorCode, path: string, message: string) {
    super(message)
    this.name = 'CanonicalJsonError'
    this.code = code
    this.path = path
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function formatPathSegment(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

function encodeCanonicalJsonValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          'canonical_json_invalid_number',
          path,
          `canonical json requires finite numbers at ${path}`,
        )
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new CanonicalJsonError(
        'canonical_json_invalid_type',
        path,
        `canonical json does not support ${typeof value} values at ${path}`,
      )
  }

  if (seen.has(value)) {
    throw new CanonicalJsonError(
      'canonical_json_cycle',
      path,
      `canonical json does not support cycles at ${path}`,
    )
  }

  seen.add(value)

  try {
    if (Array.isArray(value)) {
      const parts: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new CanonicalJsonError(
            'canonical_json_sparse_array',
            `${path}[${index}]`,
            `canonical json does not support sparse arrays at ${path}[${index}]`,
          )
        }
        parts.push(encodeCanonicalJsonValue(value[index], `${path}[${index}]`, seen))
      }
      return `[${parts.join(',')}]`
    }

    if (!isPlainObject(value)) {
      throw new CanonicalJsonError(
        'canonical_json_non_plain_object',
        path,
        `canonical json only supports plain objects at ${path}`,
      )
    }

    const parts: string[] = []
    for (const key of Object.keys(value).sort()) {
      const propertyPath = `${path}${formatPathSegment(key)}`
      parts.push(`${JSON.stringify(key)}:${encodeCanonicalJsonValue(value[key], propertyPath, seen)}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export function canonicalizeJson(value: unknown): string {
  return encodeCanonicalJsonValue(value, '$', new Set<object>())
}
