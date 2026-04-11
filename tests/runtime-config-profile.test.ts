import { describe, expect, it } from 'vitest'
import {
  normalizeBoundedInteger,
  parseBoundedInteger,
  resolveGatewayResourceProfile,
} from '../src/runtime/config/profile.js'

describe('runtime config profile helpers', () => {
  it('normalizes gateway resource profile aliases', () => {
    expect(resolveGatewayResourceProfile(undefined)).toBeNull()
    expect(resolveGatewayResourceProfile('  WeDoS-Small  ')).toBe('wedos_small')
    expect(resolveGatewayResourceProfile('m')).toBe('wedos_medium')
    expect(resolveGatewayResourceProfile('memory_only')).toBe('diskless')
  })

  it('returns null for unknown gateway resource profiles', () => {
    expect(resolveGatewayResourceProfile('unknown-profile')).toBeNull()
  })

  it('parses bounded integers with inclusive limits and fallback semantics', () => {
    expect(parseBoundedInteger(undefined, 7, 1, 9)).toBe(7)
    expect(parseBoundedInteger('0', 7, 1, 9)).toBe(7)
    expect(parseBoundedInteger('-2', 7, 0, 9)).toBe(7)
    expect(parseBoundedInteger('4.9', 7, 1, 9)).toBe(4)
    expect(parseBoundedInteger('99', 7, 1, 9)).toBe(9)
  })

  it('normalizes bounded integer values from code paths that already have numbers', () => {
    expect(normalizeBoundedInteger(undefined, 5, 1, 9)).toBe(5)
    expect(normalizeBoundedInteger(Number.NaN, 5, 1, 9)).toBe(5)
    expect(normalizeBoundedInteger(0, 5, 1, 9)).toBe(5)
    expect(normalizeBoundedInteger(4.9, 5, 1, 9)).toBe(4)
    expect(normalizeBoundedInteger(99, 5, 1, 9)).toBe(9)
  })
})
