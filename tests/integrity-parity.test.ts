import { describe, expect, it } from 'vitest'
import { verifyManifestEntry } from '../src/integrity/verifier.js'

type ParityCase = {
  name: string
  entry: { root?: string | null; hash?: string | null; uriHash?: string | null }
  policy: { activeRoot?: string | null; trustedRoots?: readonly string[]; expectedHash?: string | null; paused?: boolean }
  expected: { ok: boolean; code?: 'integrity_mismatch' | 'missing_trusted_root' | 'policy_paused' }
}

function assertParityCase(testCase: ParityCase) {
  expect(verifyManifestEntry(testCase.entry, testCase.policy)).toEqual(testCase.expected)
}

describe('kernel-migration P0 integrity parity', () => {
  it('fails closed when the policy is paused', () => {
    assertParityCase({
      name: 'paused policy blocks mutating/serving paths',
      entry: { root: 'root-a', hash: 'hash-a' },
      policy: { activeRoot: 'root-a', paused: true },
      expected: { ok: false, code: 'policy_paused' },
    })
  })

  it('classifies missing trusted root as a hard failure', () => {
    assertParityCase({
      name: 'missing trusted root is not recoverable',
      entry: { hash: 'hash-a' },
      policy: { activeRoot: 'root-a' },
      expected: { ok: false, code: 'missing_trusted_root' },
    })
  })

  it('classifies root or artifact mismatch as integrity mismatch', () => {
    assertParityCase({
      name: 'revoked or mismatched integrity facts are blocked',
      entry: { root: 'revoked-root', hash: 'hash-a' },
      policy: { activeRoot: 'root-a', trustedRoots: ['root-a', 'root-b'] },
      expected: { ok: false, code: 'integrity_mismatch' },
    })
    assertParityCase({
      name: 'hash mismatch is blocked too',
      entry: { root: 'root-a', uriHash: 'hash-a' },
      policy: { activeRoot: 'root-a', expectedHash: 'hash-b' },
      expected: { ok: false, code: 'integrity_mismatch' },
    })
  })

  it('keeps the happy path explicit when policy and artifact line up', () => {
    assertParityCase({
      name: 'trusted artifact remains serveable',
      entry: { root: 'root-a', hash: 'hash-a' },
      policy: { activeRoot: 'root-a', trustedRoots: ['root-a'], expectedHash: 'hash-a' },
      expected: { ok: true },
    })
  })
})
