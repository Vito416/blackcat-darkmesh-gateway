export type ConfigValueSourceKind = 'env' | 'fallback' | 'default' | 'missing'

export type ConfigValueSource = {
  kind: ConfigValueSourceKind
  name: string
  redacted: boolean
  value?: string
}

export type ConfigValueErrorCode = 'missing_required_env' | 'invalid_required_env' | 'invalid_optional_env'

export type ConfigValueSuccess<T> = {
  ok: true
  name: string
  value: T
  source: ConfigValueSource
}

export type ConfigValueFailure = {
  ok: false
  name: string
  code: ConfigValueErrorCode
  message: string
  source: ConfigValueSource
}

export type ConfigValueResult<T> = ConfigValueSuccess<T> | ConfigValueFailure

export type ConfigValueParser<T> = (raw: string) => T | null

export type ConfigLoadOptions<T> = {
  env?: Record<string, string | undefined>
  required?: boolean
  secret?: boolean
  fallbackValue?: T
  defaultValue?: T
}

const REDACTED_VALUE = '[redacted]'

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeEnvRaw(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function displayValue(raw: string, secret: boolean): string {
  return secret ? REDACTED_VALUE : raw
}

function source(kind: ConfigValueSourceKind, name: string, redacted: boolean, value?: string): ConfigValueSource {
  return value === undefined ? { kind, name, redacted } : { kind, name, redacted, value }
}

function success<T>(name: string, value: T, kind: Exclude<ConfigValueSourceKind, 'missing'>, display: string, secret: boolean): ConfigValueSuccess<T> {
  return {
    ok: true,
    name,
    value,
    source: source(kind, name, secret, displayValue(display, secret)),
  }
}

function failure(name: string, code: ConfigValueErrorCode, message: string, kind: ConfigValueSourceKind, secret: boolean, value?: string): ConfigValueFailure {
  return {
    ok: false,
    name,
    code,
    message,
    source: source(kind, name, secret, value === undefined ? undefined : displayValue(value, secret)),
  }
}

function resolveFromEnv<T>(
  name: string,
  parser: ConfigValueParser<T>,
  options: ConfigLoadOptions<T>,
): ConfigValueResult<T | undefined> {
  const env = options.env ?? process.env
  const secret = options.secret === true
  const required = options.required === true

  const raw = normalizeEnvRaw(env[name])
  if (raw !== undefined) {
    const parsed = parser(raw)
    if (parsed === null) {
      return failure(
        name,
        required ? 'invalid_required_env' : 'invalid_optional_env',
        `Invalid env var value for ${name}`,
        'env',
        secret,
        raw,
      )
    }
    return success(name, parsed, 'env', raw, secret)
  }

  if (hasOwn(options, 'fallbackValue')) {
    return success(name, options.fallbackValue as T, 'fallback', stringifyFallback(options.fallbackValue as T), secret)
  }

  if (hasOwn(options, 'defaultValue')) {
    return success(name, options.defaultValue as T, 'default', stringifyFallback(options.defaultValue as T), secret)
  }

  if (required) {
    return failure(name, 'missing_required_env', `Missing required env var ${name}`, 'missing', secret)
  }

  return {
    ok: true,
    name,
    value: undefined,
    source: source('missing', name, secret),
  }
}

function stringifyFallback(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function parseEnvInteger(raw: string): number | null {
  if (!/^[+-]?\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

export function parseEnvBoolean(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  return null
}

export function loadConfigValue<T>(
  name: string,
  parser: ConfigValueParser<T>,
  options: ConfigLoadOptions<T> = {},
): ConfigValueResult<T | undefined> {
  return resolveFromEnv(name, parser, options)
}

export function loadStringConfig(
  name: string,
  options: ConfigLoadOptions<string> = {},
): ConfigValueResult<string | undefined> {
  return loadConfigValue(name, (raw) => raw, options)
}

export function loadIntegerConfig(
  name: string,
  options: ConfigLoadOptions<number> = {},
): ConfigValueResult<number | undefined> {
  return loadConfigValue(name, parseEnvInteger, options)
}

export function loadBooleanConfig(
  name: string,
  options: ConfigLoadOptions<boolean> = {},
): ConfigValueResult<boolean | undefined> {
  return loadConfigValue(name, parseEnvBoolean, options)
}

