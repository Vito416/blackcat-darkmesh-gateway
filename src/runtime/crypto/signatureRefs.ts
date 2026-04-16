export type SignatureRefListValidationResult =
  | { ok: true; refs: string[] }
  | { ok: false; error: string }

export type SignatureRefMatchResult =
  | { ok: true; matchedRefs: string[] }
  | { ok: false; error: string }

export type SignatureRefMatchOptions = {
  strict?: boolean
}

function normalizeSignatureRef(ref: string): string {
  return ref.trim()
}

function uniqueSignatureRefs(refs: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const ref of refs) {
    const trimmed = normalizeSignatureRef(ref)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

export function normalizeSignatureRefList(refs: readonly string[]): string[] {
  return uniqueSignatureRefs(refs)
}

export function validateSignatureRefList(value: unknown): SignatureRefListValidationResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'signatureRef list must be an array of strings' }
  }

  if (value.length === 0) {
    return { ok: false, error: 'signatureRef list must not be empty' }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== 'string') {
      return { ok: false, error: 'signatureRef list must be an array of strings' }
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!normalizeSignatureRef(value[index])) {
      return { ok: false, error: `signatureRef[${index}] must not be empty` }
    }
  }

  const refs = uniqueSignatureRefs(value)
  if (refs.length === 0) {
    return { ok: false, error: 'signatureRef list must not be empty' }
  }

  return { ok: true, refs }
}

function sameSignatureRefSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightRefs = new Set(right)
  for (const ref of left) {
    if (!rightRefs.has(ref)) return false
  }
  return true
}

function intersectSignatureRefs(left: readonly string[], right: readonly string[]): string[] {
  const rightRefs = new Set(right)
  return left.filter((ref) => rightRefs.has(ref))
}

export function validateExpectedSignatureRefs(
  actual: unknown,
  expected: unknown,
  options: SignatureRefMatchOptions = {},
): SignatureRefMatchResult {
  const actualResult = validateSignatureRefList(actual)
  if (actualResult.ok === false) {
    const failure = actualResult as Extract<SignatureRefListValidationResult, { ok: false }>
    return { ok: false, error: failure.error }
  }

  const expectedResult = validateSignatureRefList(expected)
  if (expectedResult.ok === false) {
    const failure = expectedResult as Extract<SignatureRefListValidationResult, { ok: false }>
    return { ok: false, error: failure.error }
  }

  if (options.strict) {
    if (!sameSignatureRefSet(actualResult.refs, expectedResult.refs)) {
      return { ok: false, error: 'signatureRef lists must match exactly' }
    }
    return { ok: true, matchedRefs: actualResult.refs }
  }

  const matchedRefs = intersectSignatureRefs(actualResult.refs, expectedResult.refs)
  if (matchedRefs.length === 0) {
    return { ok: false, error: 'signatureRef lists do not overlap' }
  }

  return { ok: true, matchedRefs }
}

export function signatureRefListsOverlap(left: unknown, right: unknown): boolean {
  const result = validateExpectedSignatureRefs(left, right)
  return result.ok
}
