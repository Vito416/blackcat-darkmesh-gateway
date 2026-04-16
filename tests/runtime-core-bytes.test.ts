import { describe, expect, it } from 'vitest'

import { bodyExceedsUtf8Limit, readPositiveInteger, utf8ByteLength } from '../src/runtime/core/bytes.js'

describe('runtime core byte helpers', () => {
  it('parses valid positive integers', () => {
    expect(readPositiveInteger('42', 7)).toBe(42)
    expect(readPositiveInteger('9', 7, 5)).toBe(9)
  })

  it('falls back for invalid and too-small values', () => {
    expect(readPositiveInteger(undefined, 7)).toBe(7)
    expect(readPositiveInteger('abc', 7)).toBe(7)
    expect(readPositiveInteger('0', 7)).toBe(7)
    expect(readPositiveInteger('4', 7, 5)).toBe(7)
  })

  it('measures UTF-8 byte length for ascii and unicode strings', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('cafe')).toBe(4)
    expect(utf8ByteLength('café')).toBe(5)
    expect(utf8ByteLength('😀')).toBe(4)
  })

  it('checks body byte limits for exact and over-limit bodies', () => {
    const body = 'hello'
    expect(bodyExceedsUtf8Limit(body, 6)).toBe(false)
    expect(bodyExceedsUtf8Limit(body, 5)).toBe(false)
    expect(bodyExceedsUtf8Limit(body, 4)).toBe(true)
  })
})
