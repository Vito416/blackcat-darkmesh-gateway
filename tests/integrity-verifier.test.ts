import { describe, expect, it } from 'vitest'
import { isTrustedRoot, sha256Hex, verifyManifestEntry } from '../src/integrity/verifier.js'

describe('integrity verifier', () => {
  it('hashes strings and bytes deterministically', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('recognizes trusted roots', () => {
    expect(isTrustedRoot('root-a', ['root-a', 'root-b'])).toBe(true)
    expect(isTrustedRoot('root-c', ['root-a', 'root-b'])).toBe(false)
    expect(isTrustedRoot('', ['root-a'])).toBe(false)
  })

  it('accepts a manifest entry when root and hash match', () => {
    const result = verifyManifestEntry(
      { root: 'root-a', hash: 'hash-a' },
      { activeRoot: 'root-a', expectedHash: 'hash-a' },
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects when the trusted root is missing', () => {
    const result = verifyManifestEntry({ root: undefined, hash: 'hash-a' }, { activeRoot: 'root-a' })
    expect(result).toEqual({ ok: false, code: 'missing_trusted_root' })
  })

  it('rejects when the entry root is not trusted', () => {
    const result = verifyManifestEntry(
      { root: 'revoked-root', hash: 'hash-a' },
      { activeRoot: 'root-a', trustedRoots: ['root-a', 'root-b'] },
    )
    expect(result).toEqual({ ok: false, code: 'integrity_mismatch' })
  })

  it('rejects when policy is paused', () => {
    const result = verifyManifestEntry({ root: 'root-a', hash: 'hash-a' }, { activeRoot: 'root-a', paused: true })
    expect(result).toEqual({ ok: false, code: 'policy_paused' })
  })

  it('rejects when the manifest hash mismatches', () => {
    const result = verifyManifestEntry(
      { root: 'root-a', uriHash: 'hash-a' },
      { activeRoot: 'root-a', expectedHash: 'hash-b' },
    )
    expect(result).toEqual({ ok: false, code: 'integrity_mismatch' })
  })
})
