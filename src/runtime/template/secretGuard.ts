import { loadStringConfig } from '../config/loader.js'

type SecretGuardHit = {
  path: string
  key: string
}

export type TemplateSecretGuardResult =
  | { ok: true }
  | {
      ok: false
      status: number
      error: string
      detail: {
        forbiddenFields: string[]
      }
    }

const SECRET_GUARD_ALLOWLIST_ENV = 'GATEWAY_TEMPLATE_SECRET_GUARD_ALLOWLIST'
const SECRET_GUARD_STRICT_ENV = 'GATEWAY_TEMPLATE_SECRET_GUARD_STRICT'

const DEFAULT_ALLOWED_KEYS = new Set(['paymentId', 'provider', 'siteId'])
const SUSPICIOUS_KEY_TOKENS = ['password', 'secret', 'privatekey', 'apikey', 'token', 'smtp', 'bearer', 'signingkey', 'walletjwk']

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readEnvString(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok || typeof loaded.value !== 'string') return undefined
  const value = loaded.value.trim()
  return value.length > 0 ? value : undefined
}

function isStrictEnabled(): boolean {
  const raw = readEnvString(SECRET_GUARD_STRICT_ENV)
  if (!raw) return true
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase())
}

function readAllowlist(): Set<string> {
  const raw = readEnvString(SECRET_GUARD_ALLOWLIST_ENV)
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSuspiciousKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (!normalized) return false
  return SUSPICIOUS_KEY_TOKENS.some((token) => normalized.includes(token))
}

function isAllowedKey(key: string, envAllowlist: Set<string>): boolean {
  return DEFAULT_ALLOWED_KEYS.has(key) || envAllowlist.has(key)
}

function walkPayload(
  value: unknown,
  path: string,
  envAllowlist: Set<string>,
  seen: WeakSet<object>,
  hits: SecretGuardHit[],
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      walkPayload(value[index], `${path}[${index}]`, envAllowlist, seen, hits)
    }
    return
  }

  if (!isObj(value)) return
  if (seen.has(value)) return
  seen.add(value)

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (!isAllowedKey(key, envAllowlist) && isSuspiciousKey(key)) {
      hits.push({ path: childPath, key })
    }
    walkPayload(child, childPath, envAllowlist, seen, hits)
  }
}

export function inspectTemplateSecretPayload(payload: unknown): TemplateSecretGuardResult {
  if (!isStrictEnabled()) return { ok: true }
  if (!isObj(payload) && !Array.isArray(payload)) return { ok: true }

  const envAllowlist = readAllowlist()
  const hits: SecretGuardHit[] = []
  walkPayload(payload, 'payload', envAllowlist, new WeakSet<object>(), hits)

  if (hits.length === 0) return { ok: true }

  const forbiddenFields = Array.from(new Set(hits.map((hit) => hit.path))).sort((left, right) =>
    left.localeCompare(right),
  )

  return {
    ok: false,
    status: 400,
    error: 'payload_contains_forbidden_secret_fields',
    detail: { forbiddenFields },
  }
}
