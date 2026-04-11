import { describe, expect, it } from 'vitest'

import { CanonicalJsonError, canonicalizeJson } from '../src/runtime/core/index.js'

describe('runtime core canonical json helper', () => {
  it('encodes nested objects with deterministic key ordering', () => {
    expect(
      canonicalizeJson({
        z: 1,
        a: {
          d: true,
          c: [3, { y: 'last', x: 'first' }],
        },
        b: 'two',
      }),
    ).toBe('{"a":{"c":[3,{"x":"first","y":"last"}],"d":true},"b":"two","z":1}')
  })

  it('preserves array order while normalizing object keys and numbers', () => {
    expect(
      canonicalizeJson([{ b: 2, a: 1 }, -0, 'ok']),
    ).toBe('[{"a":1,"b":2},0,"ok"]')
  })

  it('rejects unsupported value types with the offending path', () => {
    expect(() =>
      canonicalizeJson({
        payload: {
          missing: undefined,
        },
      }),
    ).toThrowError(CanonicalJsonError)

    try {
      canonicalizeJson({ payload: { missing: undefined } })
      expect.unreachable('expected canonicalizeJson to reject undefined values')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'canonical_json_invalid_type',
        path: '$.payload.missing',
      })
    }
  })

  it('rejects non-finite numbers, sparse arrays, and non-plain objects', () => {
    expect(() => canonicalizeJson({ attempts: Number.NaN })).toThrowError(CanonicalJsonError)
    expect(() => canonicalizeJson([1, , 3])).toThrowError(CanonicalJsonError)
    expect(() => canonicalizeJson({ writtenAt: new Date('2026-04-11T00:00:00.000Z') })).toThrowError(
      CanonicalJsonError,
    )

    try {
      canonicalizeJson({ attempts: Number.POSITIVE_INFINITY })
      expect.unreachable('expected canonicalizeJson to reject non-finite numbers')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'canonical_json_invalid_number',
        path: '$.attempts',
      })
    }

    try {
      canonicalizeJson([1, , 3])
      expect.unreachable('expected canonicalizeJson to reject sparse arrays')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'canonical_json_sparse_array',
        path: '$[1]',
      })
    }

    try {
      canonicalizeJson({ writtenAt: new Date('2026-04-11T00:00:00.000Z') })
      expect.unreachable('expected canonicalizeJson to reject non-plain objects')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'canonical_json_non_plain_object',
        path: '$.writtenAt',
      })
    }
  })

  it('rejects cyclic structures deterministically', () => {
    const payload: { self?: unknown } = {}
    payload.self = payload

    try {
      canonicalizeJson(payload)
      expect.unreachable('expected canonicalizeJson to reject cycles')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'canonical_json_cycle',
        path: '$.self',
      })
    }
  })
})
