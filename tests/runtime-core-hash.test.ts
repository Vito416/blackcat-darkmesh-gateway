import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { canonicalizeJson, hashJsonCanonical, sha256Hex, sha256Utf8 } from '../src/runtime/core/index.js'

describe('runtime core hash helpers', () => {
  it('hashes utf8 strings with known sha256 vectors', () => {
    expect(sha256Utf8('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Utf8('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Utf8('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    )
  })

  it('hashes bytes deterministically', () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 255])
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('hashes canonical json deterministically across key order', () => {
    const left = { z: 1, a: { b: true, c: ['x', 'y'] }, meta: { id: 'A-1' } }
    const right = { meta: { id: 'A-1' }, a: { c: ['x', 'y'], b: true }, z: 1 }

    const leftCanonical = canonicalizeJson(left)
    const rightCanonical = canonicalizeJson(right)

    expect(leftCanonical).toBe('{"a":{"b":true,"c":["x","y"]},"meta":{"id":"A-1"},"z":1}')
    expect(rightCanonical).toBe(leftCanonical)
    expect(hashJsonCanonical(left)).toBe(hashJsonCanonical(right))
    expect(hashJsonCanonical(left)).toBe(sha256Utf8(leftCanonical))
  })

  it('uses a caller-provided canonicalizer when supplied', () => {
    const canonicalizeFn = (value: unknown) => `custom:${JSON.stringify(value)}`
    const payload = { route: '/products', version: 2 }

    expect(hashJsonCanonical(payload, canonicalizeFn)).toBe(sha256Utf8('custom:{"route":"/products","version":2}'))
  })
})
