import { createHash } from 'node:crypto'

export interface IntegrityManifestEntry {
  root?: string | null
  hash?: string | null
  uriHash?: string | null
  metaHash?: string | null
}

export interface IntegrityTrustedRoot {
  activeRoot?: string | null
  trustedRoots?: readonly string[]
  expectedHash?: string | null
  paused?: boolean
}

export interface IntegrityCheckResult {
  ok: boolean
  code?: 'integrity_mismatch' | 'missing_trusted_root' | 'policy_paused'
}

function normalizeBuffer(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input
}

function normalizeIntegrityToken(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null

  let value = input.trim()
  if (!value) return null

  const commonPrefixes = [/^sha256[:=\-]/i, /^0x/i]
  let normalized = true
  while (normalized) {
    normalized = false
    for (const prefix of commonPrefixes) {
      const stripped = value.replace(prefix, '')
      if (stripped !== value) {
        value = stripped.trim()
        normalized = true
      }
    }
  }

  value = value.toLowerCase()
  if (!value || /\s/.test(value)) return null
  return value
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(normalizeBuffer(input)).digest('hex')
}

export function isTrustedRoot(root: string | null | undefined, trustedRoots: readonly string[] | null | undefined): boolean {
  const normalizedRoot = normalizeIntegrityToken(root)
  if (!normalizedRoot || !trustedRoots || trustedRoots.length === 0) return false
  return trustedRoots.some((trustedRoot) => normalizeIntegrityToken(trustedRoot) === normalizedRoot)
}

function collectTrustedRoots(policy: IntegrityTrustedRoot): string[] {
  const roots = new Set<string>()
  const activeRoot = normalizeIntegrityToken(policy.activeRoot)
  if (activeRoot) {
    roots.add(activeRoot)
  }
  for (const root of policy.trustedRoots ?? []) {
    const normalizedRoot = normalizeIntegrityToken(root)
    if (normalizedRoot) roots.add(normalizedRoot)
  }
  return [...roots]
}

function resolveEntryHash(entry: IntegrityManifestEntry): string | null {
  const candidates = [entry.hash, entry.uriHash, entry.metaHash]
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeIntegrityToken(candidate)
    if (normalizedCandidate) return normalizedCandidate
  }
  return null
}

export function verifyManifestEntry(
  manifestEntry: IntegrityManifestEntry,
  trustedRoot: IntegrityTrustedRoot,
): IntegrityCheckResult {
  if (trustedRoot.paused) {
    return { ok: false, code: 'policy_paused' }
  }

  const trustedRoots = collectTrustedRoots(trustedRoot)
  const entryRoot = normalizeIntegrityToken(manifestEntry.root)
  if (!entryRoot || trustedRoots.length === 0) {
    return { ok: false, code: 'missing_trusted_root' }
  }
  if (!isTrustedRoot(entryRoot, trustedRoots)) {
    return { ok: false, code: 'integrity_mismatch' }
  }

  const expectedHash = normalizeIntegrityToken(trustedRoot.expectedHash)
  if (!expectedHash) {
    return { ok: true }
  }

  const actualHash = resolveEntryHash(manifestEntry)
  if (!actualHash) {
    return { ok: false, code: 'missing_trusted_root' }
  }

  if (actualHash !== expectedHash) {
    return { ok: false, code: 'integrity_mismatch' }
  }

  return { ok: true }
}
