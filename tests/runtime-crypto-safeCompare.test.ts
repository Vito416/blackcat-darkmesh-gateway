import { describe, expect, it } from 'vitest'
import { safeCompareAscii, safeCompareHexOrAscii } from '../src/runtime/crypto/safeCompare.js'

describe('runtime crypto safe compare', () => {
  it('returns true for equal strings', () => {
    expect(safeCompareAscii('deadbeef', 'deadbeef')).toBe(true)
    expect(safeCompareHexOrAscii('whsec_test', 'whsec_test')).toBe(true)
  })

  it('returns false for length mismatch', () => {
    expect(safeCompareAscii('deadbeef', 'deadbeef00')).toBe(false)
    expect(safeCompareHexOrAscii('whsec_test', 'whsec_test_2')).toBe(false)
  })

  it('handles unicode and ascii boundaries safely', () => {
    expect(safeCompareAscii('cafe', 'café')).toBe(false)
    expect(safeCompareHexOrAscii('a1b2', 'a1b2🙂')).toBe(false)
  })
})
