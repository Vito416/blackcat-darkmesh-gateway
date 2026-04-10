import type {
  IntegrityAuditRecord,
  IntegrityAuthorityRecord,
  IntegrityPolicyRecord,
  IntegrityReleaseRecord,
  IntegritySnapshot,
} from './types.js'
import {
  fetchWithTimeout,
  getIntegrityRetryDelayMs,
  isAbortError,
  isTransientIntegrityFetchStatus,
  resolveIntegrityFetchControl,
  sleep,
  type IntegrityFetchControl,
  type IntegrityFetchLike,
} from './fetch-control.js'
import { inc } from '../metrics.js'

export type IntegrityErrorCode =
  | 'integrity_invalid_snapshot'
  | 'integrity_release_root_mismatch'
  | 'missing_trusted_root'
  | 'integrity_fetch_failed'

export class IntegritySnapshotError extends Error {
  code: IntegrityErrorCode

  constructor(code: IntegrityErrorCode, message: string) {
    super(message)
    this.name = 'IntegritySnapshotError'
    this.code = code
  }
}

const NON_RETRYABLE_INTEGRITY_ERROR_CODES = new Set<IntegrityErrorCode>([
  'integrity_invalid_snapshot',
  'integrity_release_root_mismatch',
])

export type FetchIntegritySnapshotOptions = {
  url?: string
  fetchImpl?: IntegrityFetchLike
  timeoutMs?: number
  retryAttempts?: number
  retryBackoffMs?: number
}

type IntegrityMirrorSettings = {
  urls: string[]
  strict: boolean
}

type SnapshotInput = Record<string, unknown>

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function parseRelease(raw: unknown): IntegrityReleaseRecord {
  if (!isObject(raw)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release must be an object')
  if (!isString(raw.componentId)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release.componentId is required')
  if (!isString(raw.version)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release.version is required')
  if (!isString(raw.root)) throw new IntegritySnapshotError('missing_trusted_root', 'release.root is required')
  if (!isString(raw.uriHash)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release.uriHash is required')
  if (!isString(raw.metaHash)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release.metaHash is required')
  if (!isString(raw.publishedAt)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release.publishedAt is required')
  const release: IntegrityReleaseRecord = {
    componentId: raw.componentId,
    version: raw.version,
    root: raw.root,
    uriHash: raw.uriHash,
    metaHash: raw.metaHash,
    publishedAt: raw.publishedAt,
  }
  if (raw.revokedAt !== undefined) {
    if (!isString(raw.revokedAt)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'release.revokedAt must be a string')
    release.revokedAt = raw.revokedAt
  }
  return release
}

function parsePolicy(raw: unknown): IntegrityPolicyRecord {
  if (!isObject(raw)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy must be an object')
  if (!isString(raw.activeRoot)) throw new IntegritySnapshotError('missing_trusted_root', 'policy.activeRoot is required')
  if (!isString(raw.activePolicyHash)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.activePolicyHash is required')
  if (typeof raw.paused !== 'boolean') throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.paused must be boolean')
  if (!isNumber(raw.maxCheckInAgeSec)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.maxCheckInAgeSec must be a finite number')
  const policy: IntegrityPolicyRecord = {
    activeRoot: raw.activeRoot,
    activePolicyHash: raw.activePolicyHash,
    paused: raw.paused,
    maxCheckInAgeSec: raw.maxCheckInAgeSec,
  }
  if (raw.pendingUpgrade !== undefined) {
    if (!isObject(raw.pendingUpgrade)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.pendingUpgrade must be an object')
    if (!isString(raw.pendingUpgrade.root)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.pendingUpgrade.root is required')
    if (!isString(raw.pendingUpgrade.hash)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.pendingUpgrade.hash is required')
    if (!isString(raw.pendingUpgrade.expiry)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.pendingUpgrade.expiry is required')
    if (!isString(raw.pendingUpgrade.proposedAt)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.pendingUpgrade.proposedAt is required')
    policy.pendingUpgrade = {
      root: raw.pendingUpgrade.root,
      hash: raw.pendingUpgrade.hash,
      expiry: raw.pendingUpgrade.expiry,
      proposedAt: raw.pendingUpgrade.proposedAt,
    }
  }
  if (raw.compatibilityState !== undefined) {
    if (!isObject(raw.compatibilityState)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.compatibilityState must be an object')
    if (!isString(raw.compatibilityState.root)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.compatibilityState.root is required')
    if (!isString(raw.compatibilityState.hash)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.compatibilityState.hash is required')
    if (!isString(raw.compatibilityState.until)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'policy.compatibilityState.until is required')
    policy.compatibilityState = {
      root: raw.compatibilityState.root,
      hash: raw.compatibilityState.hash,
      until: raw.compatibilityState.until,
    }
  }
  return policy
}

function parseAuthority(raw: unknown): IntegrityAuthorityRecord {
  if (!isObject(raw)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'authority must be an object')
  if (!isString(raw.root)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'authority.root is required')
  if (!isString(raw.upgrade)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'authority.upgrade is required')
  if (!isString(raw.emergency)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'authority.emergency is required')
  if (!isString(raw.reporter)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'authority.reporter is required')
  if (!isStringArray(raw.signatureRefs)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'authority.signatureRefs must be a string array')
  return {
    root: raw.root,
    upgrade: raw.upgrade,
    emergency: raw.emergency,
    reporter: raw.reporter,
    signatureRefs: raw.signatureRefs,
  }
}

function parseAudit(raw: unknown): IntegrityAuditRecord {
  if (!isObject(raw)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit must be an object')
  if (!isNumber(raw.seqFrom)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit.seqFrom is required')
  if (!isNumber(raw.seqTo)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit.seqTo is required')
  if (!isString(raw.merkleRoot)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit.merkleRoot is required')
  if (!isString(raw.metaHash)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit.metaHash is required')
  if (!isString(raw.reporterRef)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit.reporterRef is required')
  if (!isString(raw.acceptedAt)) throw new IntegritySnapshotError('integrity_invalid_snapshot', 'audit.acceptedAt is required')
  return {
    seqFrom: raw.seqFrom,
    seqTo: raw.seqTo,
    merkleRoot: raw.merkleRoot,
    metaHash: raw.metaHash,
    reporterRef: raw.reporterRef,
    acceptedAt: raw.acceptedAt,
  }
}

function normalizeTrustedRoot(value: string): string {
  return value.trim()
}

function parseMirrorSettings(): IntegrityMirrorSettings {
  const urls = (process.env.AO_INTEGRITY_MIRROR_URLS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return {
    urls,
    strict: (process.env.AO_INTEGRITY_MIRROR_STRICT || '').trim() === '1',
  }
}

function assertReleaseRootParity(release: IntegrityReleaseRecord, policy: IntegrityPolicyRecord): void {
  const releaseRoot = normalizeTrustedRoot(release.root)
  const activeRoot = normalizeTrustedRoot(policy.activeRoot)

  if (releaseRoot !== activeRoot) {
    throw new IntegritySnapshotError(
      'integrity_release_root_mismatch',
      'policy.activeRoot must match release.root',
    )
  }

  if (release.revokedAt !== undefined) {
    throw new IntegritySnapshotError(
      'integrity_release_root_mismatch',
      'release.revokedAt is not allowed on the active snapshot',
    )
  }

  const compatibilityStateRoot = policy.compatibilityState?.root
  if (typeof compatibilityStateRoot === 'string' && compatibilityStateRoot.trim()) {
    const normalizedCompatibilityRoot = normalizeTrustedRoot(compatibilityStateRoot)
    if (normalizedCompatibilityRoot !== releaseRoot && normalizedCompatibilityRoot !== activeRoot) {
      throw new IntegritySnapshotError(
        'integrity_release_root_mismatch',
        'policy.compatibilityState.root must match release.root or policy.activeRoot',
      )
    }
  }
}

function extractCodecPayload(raw: Record<string, unknown>): unknown | undefined {
  if (!('status' in raw)) return undefined
  const status = typeof raw.status === 'string' ? raw.status : ''
  if (!status) return undefined

  if (status === 'OK') {
    const payloadKeys = ['payload', 'body', 'result', 'data'] as const
    for (const key of payloadKeys) {
      if (key in raw) {
        return raw[key]
      }
    }
    throw new IntegritySnapshotError(
      'integrity_invalid_snapshot',
      'codec envelope status OK is missing a payload field',
    )
  }

  if (status === 'ERROR') {
    const code = typeof raw.code === 'string' ? raw.code : 'upstream_error'
    const message = typeof raw.message === 'string' ? raw.message : 'upstream returned error envelope'
    throw new IntegritySnapshotError('integrity_fetch_failed', `${code}:${message}`)
  }

  return undefined
}

function unwrapSnapshot(raw: unknown): unknown {
  if (!isObject(raw)) return raw

  const payload = extractCodecPayload(raw)
  if (payload !== undefined) {
    return payload
  }
  return raw
}

function parseSnapshot(raw: unknown): IntegritySnapshot {
  raw = unwrapSnapshot(raw)
  if (!isObject(raw)) {
    throw new IntegritySnapshotError('integrity_invalid_snapshot', 'snapshot must be a JSON object')
  }
  const release = parseRelease(raw.release)
  const policy = parsePolicy(raw.policy)
  const authority = parseAuthority(raw.authority)
  const audit = parseAudit(raw.audit)
  assertReleaseRootParity(release, policy)
  return { release, policy, authority, audit }
}

async function fetchSnapshotFromUrl(
  url: string,
  fetchImpl: IntegrityFetchLike,
  fetchControl: IntegrityFetchControl,
): Promise<IntegritySnapshot> {
  for (let attempt = 1; attempt <= fetchControl.retryAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, fetchControl.timeoutMs)

      if (!response.ok) {
        if (isTransientIntegrityFetchStatus(response.status) && attempt < fetchControl.retryAttempts) {
          await sleep(getIntegrityRetryDelayMs(fetchControl.retryBackoffMs, attempt, fetchControl.retryJitterMs))
          continue
        }
        throw new IntegritySnapshotError('integrity_fetch_failed', `upstream returned ${response.status}`)
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid json'
        throw new IntegritySnapshotError('integrity_invalid_snapshot', message)
      }

      return parseSnapshot(raw as SnapshotInput)
    } catch (error) {
      if (error instanceof IntegritySnapshotError) {
        if (NON_RETRYABLE_INTEGRITY_ERROR_CODES.has(error.code)) {
          throw error
        }
        throw error
      }

      if ((isAbortError(error) || error instanceof Error) && attempt < fetchControl.retryAttempts) {
        await sleep(getIntegrityRetryDelayMs(fetchControl.retryBackoffMs, attempt, fetchControl.retryJitterMs))
        continue
      }

      const message = error instanceof Error ? error.message : 'request failed'
      throw new IntegritySnapshotError('integrity_fetch_failed', message)
    }
  }

  throw new IntegritySnapshotError('integrity_fetch_failed', 'request failed')
}

function compareMirrorSnapshot(primary: IntegritySnapshot, mirror: IntegritySnapshot): string[] {
  const mismatches: string[] = []

  if (normalizeTrustedRoot(primary.release.root) !== normalizeTrustedRoot(mirror.release.root)) {
    mismatches.push('release.root')
  }

  if (normalizeTrustedRoot(primary.policy.activeRoot) !== normalizeTrustedRoot(mirror.policy.activeRoot)) {
    mismatches.push('policy.activeRoot')
  }

  if (primary.release.version !== mirror.release.version) {
    mismatches.push('release.version')
  }

  return mismatches
}

export async function fetchIntegritySnapshot(opts: FetchIntegritySnapshotOptions = {}): Promise<IntegritySnapshot> {
  const url = opts.url || process.env.AO_INTEGRITY_URL
  if (!url) {
    throw new IntegritySnapshotError('integrity_fetch_failed', 'AO_INTEGRITY_URL is not configured')
  }

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new IntegritySnapshotError('integrity_fetch_failed', 'fetch is not available')
  }

  const fetchControl = resolveIntegrityFetchControl({
    timeoutMs: opts.timeoutMs,
    retryAttempts: opts.retryAttempts,
    retryBackoffMs: opts.retryBackoffMs,
  })

  const primary = await fetchSnapshotFromUrl(url, fetchImpl, fetchControl)
  const mirrors = parseMirrorSettings()

  if (mirrors.urls.length === 0) {
    return primary
  }

  const issues: string[] = []

  for (const mirrorUrl of mirrors.urls) {
    try {
      const mirror = await fetchSnapshotFromUrl(mirrorUrl, fetchImpl, fetchControl)
      const mismatches = compareMirrorSnapshot(primary, mirror)
      if (mismatches.length > 0) {
        inc('gateway_integrity_mirror_mismatch')
        issues.push(`${mirrorUrl}: ${mismatches.join(', ')}`)
      }
    } catch (error) {
      inc('gateway_integrity_mirror_fetch_fail')
      const detail = error instanceof Error ? error.message : 'request failed'
      issues.push(`${mirrorUrl}: ${detail}`)
    }
  }

  if (mirrors.strict && issues.length > 0) {
    throw new IntegritySnapshotError('integrity_fetch_failed', `mirror consistency check failed: ${issues.join('; ')}`)
  }

  return primary
}
