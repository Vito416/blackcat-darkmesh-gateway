export type IntegrityReleaseRecord = {
  componentId: string
  version: string
  root: string
  uriHash: string
  metaHash: string
  publishedAt: string
  revokedAt?: string
}

export type IntegrityPolicyRecord = {
  activeRoot: string
  activePolicyHash: string
  paused: boolean
  maxCheckInAgeSec: number
  pendingUpgrade?: {
    root: string
    hash: string
    expiry: string
    proposedAt: string
  }
  compatibilityState?: {
    root: string
    hash: string
    until: string
  }
}

export type IntegrityAuthorityRecord = {
  root: string
  upgrade: string
  emergency: string
  reporter: string
  signatureRefs: string[]
}

export type IntegrityAuditRecord = {
  seqFrom: number
  seqTo: number
  merkleRoot: string
  metaHash: string
  reporterRef: string
  acceptedAt: string
}

export type IntegritySnapshot = {
  release: IntegrityReleaseRecord
  policy: IntegrityPolicyRecord
  authority: IntegrityAuthorityRecord
  audit: IntegrityAuditRecord
}

