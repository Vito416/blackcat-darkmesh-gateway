import { describe, expect, it } from 'vitest'
import {
  buildAttestationArtifact,
  buildCanonicalSegment,
  canonicalJson,
  createDeterministicDigest,
  extractComparedFields,
  signHmac,
} from '../scripts/lib/attestation-core.js'

describe('attestation core', () => {
  it('serializes canonical json with stable key ordering', () => {
    const canonical = canonicalJson({
      z: 1,
      a: {
        b: 2,
        a: [{ y: 2, x: 1 }, { c: true, b: false }],
      },
    })

    expect(canonical).toBe('{"a":{"a":[{"x":1,"y":2},{"b":false,"c":true}],"b":2},"z":1}')
  })

  it('generates deterministic digests from canonical text', () => {
    const canonicalText = '{"a":1,"b":{"c":2}}'

    expect(createDeterministicDigest(canonicalText)).toBe(createDeterministicDigest(canonicalText))
    expect(createDeterministicDigest(canonicalText)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('extracts compared fields with consensus, mismatch, and invalid states', () => {
    const result = extractComparedFields([
      {
        label: '#1 gw-a',
        url: 'https://gw-a.example/',
        snapshot: {
          policy: { paused: false, activeRoot: 'root-a', activePolicyHash: 'hash-a' },
          release: { version: '1.2.0', root: 'root-a' },
          audit: { seqTo: 3 },
        },
      },
      {
        label: '#2 gw-b',
        url: 'https://gw-b.example/',
        snapshot: {
          policy: { paused: false, activeRoot: 'root-b', activePolicyHash: 'hash-a' },
          release: { version: '1.2.1', root: 'root-b' },
          audit: { seqTo: 3 },
        },
      },
    ])

    expect(result).toEqual(
      expect.objectContaining({
        mismatchCount: 3,
        invalidFieldCount: 0,
      }),
    )
    expect(result.comparedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'policy.paused',
          status: 'consensus',
        }),
        expect.objectContaining({
          field: 'policy.activeRoot',
          status: 'mismatch',
        }),
        expect.objectContaining({
          field: 'release.version',
          status: 'mismatch',
        }),
      ]),
    )
  })

  it('builds the attestation artifact schema without io', () => {
    const results = [
      {
        label: '#1 gw-a',
        url: 'https://gw-a.example/',
        snapshot: {
          policy: { paused: false, activeRoot: 'root-a', activePolicyHash: 'hash-a' },
          release: { version: '1.2.0', root: 'root-a' },
          audit: { seqTo: 9 },
        },
      },
      {
        label: '#2 gw-b',
        url: 'https://gw-b.example/',
        snapshot: {
          policy: { paused: false, activeRoot: 'root-a', activePolicyHash: 'hash-a' },
          release: { version: '1.2.0', root: 'root-a' },
          audit: { seqTo: 9 },
        },
      },
    ]

    const comparison = extractComparedFields(results)
    const { artifact, canonicalText, canonicalSegment } = buildAttestationArtifact({
      results,
      comparison,
      generatedAt: '2026-04-10T12:00:00.000Z',
      hmacEnvName: 'GATEWAY_ATTESTATION_HMAC_KEY',
      hmacSecret: 'super-secret',
    })

    expect(canonicalSegment).toEqual(
      buildCanonicalSegment({
        results,
        comparison,
        generatedAt: '2026-04-10T12:00:00.000Z',
      }),
    )
    expect(canonicalText).toBe(canonicalJson(canonicalSegment))
    expect(artifact).toMatchObject({
      artifactType: 'gateway-integrity-attestation',
      scriptVersionTag: 'integrity-attestation-v1',
      generatedAt: '2026-04-10T12:00:00.000Z',
      summary: {
        mismatchCount: 0,
        invalidFieldCount: 0,
        gatewayCount: 2,
      },
      hmacEnv: 'GATEWAY_ATTESTATION_HMAC_KEY',
    })
    expect(artifact.digest).toBe(createDeterministicDigest(canonicalText))
    expect(artifact.hmacSha256).toBe(`sha256:${signHmac('super-secret', canonicalText)}`)
  })
})
