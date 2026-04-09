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

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(normalizeBuffer(input)).digest('hex')
}

export function isTrustedRoot(root: string | null | undefined, trustedRoots: readonly string[] | null | undefined): boolean {
  if (!root || !trustedRoots || trustedRoots.length === 0) return false
  return trustedRoots.includes(root)
}

function collectTrustedRoots(policy: IntegrityTrustedRoot): string[] {
  const roots = new Set<string>()
  if (typeof policy.activeRoot === 'string' && policy.activeRoot.trim()) {
    roots.add(policy.activeRoot.trim())
  }
  for (const root of policy.trustedRoots ?? []) {
    if (typeof root === 'string' && root.trim()) roots.add(root.trim())
  }
  return [...roots]
}

function resolveEntryHash(entry: IntegrityManifestEntry): string | null {
  const candidates = [entry.hash, entry.uriHash, entry.metaHash]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
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
  const entryRoot = typeof manifestEntry.root === 'string' ? manifestEntry.root.trim() : ''
  if (!entryRoot || trustedRoots.length === 0) {
    return { ok: false, code: 'missing_trusted_root' }
  }
  if (!isTrustedRoot(entryRoot, trustedRoots)) {
    return { ok: false, code: 'integrity_mismatch' }
  }

  const expectedHash = typeof trustedRoot.expectedHash === 'string' ? trustedRoot.expectedHash.trim() : ''
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
