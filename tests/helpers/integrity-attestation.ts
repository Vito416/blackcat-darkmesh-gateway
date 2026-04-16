import { createHash } from 'node:crypto'

export function canonicalizeIntegrityAttestation(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((entry) => canonicalizeIntegrityAttestation(entry))

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (typeof entry !== 'undefined') {
      out[key] = canonicalizeIntegrityAttestation(entry)
    }
  }
  return out
}

export function canonicalIntegrityAttestationJson(value: unknown): string {
  return JSON.stringify(canonicalizeIntegrityAttestation(value))
}

export function digestForIntegrityAttestationArtifact(artifact: Record<string, unknown>): string {
  const segment = {
    artifactType: artifact.artifactType,
    scriptVersionTag: artifact.scriptVersionTag,
    generatedAt: artifact.generatedAt,
    gateways: artifact.gateways,
    comparedFields: artifact.comparedFields,
    summary: artifact.summary,
  }

  return `sha256:${createHash('sha256').update(canonicalIntegrityAttestationJson(segment)).digest('hex')}`
}

export function buildIntegrityAttestationArtifact(overrides: Record<string, unknown> = {}) {
  const artifact: Record<string, unknown> = {
    artifactType: 'gateway-integrity-attestation',
    scriptVersionTag: 'integrity-attestation-v1',
    generatedAt: '2026-04-10T10:20:30.000Z',
    gateways: [
      {
        label: '#1 gw-a.example',
        url: 'https://gw-a.example/integrity/state',
        snapshot: {
          release: { root: 'root-a', version: '1.2.0' },
          policy: { activeRoot: 'root-a', paused: false },
        },
      },
      {
        label: '#2 gw-b.example',
        url: 'https://gw-b.example/integrity/state',
        snapshot: {
          release: { root: 'root-a', version: '1.2.0' },
          policy: { activeRoot: 'root-a', paused: false },
        },
      },
    ],
    comparedFields: [
      {
        field: 'policy.paused',
        status: 'consensus',
        values: [
          { gateway: '#1 gw-a.example', url: 'https://gw-a.example/integrity/state', found: true, value: false },
          { gateway: '#2 gw-b.example', url: 'https://gw-b.example/integrity/state', found: true, value: false },
        ],
      },
      {
        field: 'release.root',
        status: 'consensus',
        values: [
          { gateway: '#1 gw-a.example', url: 'https://gw-a.example/integrity/state', found: true, value: 'root-a' },
          { gateway: '#2 gw-b.example', url: 'https://gw-b.example/integrity/state', found: true, value: 'root-a' },
        ],
      },
    ],
    summary: {
      mismatchCount: 0,
      invalidFieldCount: 0,
      gatewayCount: 2,
    },
    ...overrides,
  }

  return { ...artifact, digest: digestForIntegrityAttestationArtifact(artifact) }
}
