import type {
  IntegrityAuditRecord,
  IntegrityAuthorityRecord,
  IntegrityPolicyRecord,
  IntegrityReleaseRecord,
  IntegritySnapshot,
} from './types.js'

export type IntegrityErrorCode =
  | 'integrity_invalid_snapshot'
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

export type FetchIntegritySnapshotOptions = {
  url?: string
  fetchImpl?: typeof fetch
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
  return { release, policy, authority, audit }
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

  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed'
    throw new IntegritySnapshotError('integrity_fetch_failed', message)
  }

  if (!response.ok) {
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
}
