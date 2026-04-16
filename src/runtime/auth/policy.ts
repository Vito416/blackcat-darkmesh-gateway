export type AuthPolicyErrorCode = 'role_forbidden' | 'signature_ref_forbidden'

export type AuthPolicyResult = { ok: true } | { ok: false; error: AuthPolicyErrorCode }

export type PolicyValueInput = string | Iterable<string> | null | undefined

type PolicyTransform = (value: string) => string | undefined

function toIterable(values: PolicyValueInput): Iterable<string> {
  if (values == null) return []
  if (typeof values === 'string') return [values]
  return values
}

function defaultNormalize(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeRole(value: string): string | undefined {
  const normalized = defaultNormalize(value)
  return normalized ? normalized.toLowerCase() : undefined
}

export function normalizePolicyValues(values: PolicyValueInput, transform: PolicyTransform = defaultNormalize): string[] {
  const normalized = new Set<string>()
  for (const value of toIterable(values)) {
    if (typeof value !== 'string') continue
    const entry = transform(value)
    if (entry) normalized.add(entry)
  }
  return [...normalized]
}

function isCandidateAllowed(candidate: string | undefined, allowedValues: string[]): boolean {
  return !!candidate && allowedValues.includes(candidate)
}

export function requireAllowedRole(
  requiredRoles: PolicyValueInput,
  presentedRole: string | null | undefined,
  options?: { publicRole?: string },
): AuthPolicyResult {
  const required = normalizePolicyValues(requiredRoles, normalizeRole)
  if (required.length === 0) return { ok: true }

  const publicRole = options?.publicRole ? normalizeRole(options.publicRole) : undefined
  const role = normalizeRole(typeof presentedRole === 'string' ? presentedRole : '')

  if (publicRole && required.includes(publicRole)) return { ok: true }
  if (isCandidateAllowed(role, required)) return { ok: true }
  return { ok: false, error: 'role_forbidden' }
}

export function requireAuthorizedSignatureRef(
  presentedRef: string | null | undefined,
  activeRefs: PolicyValueInput,
  overlapRefs: PolicyValueInput = [],
): AuthPolicyResult {
  const allowed = new Set<string>([
    ...normalizePolicyValues(activeRefs),
    ...normalizePolicyValues(overlapRefs),
  ])
  const candidate = defaultNormalize(typeof presentedRef === 'string' ? presentedRef : '')
  if (candidate && allowed.has(candidate)) return { ok: true }
  return { ok: false, error: 'signature_ref_forbidden' }
}
