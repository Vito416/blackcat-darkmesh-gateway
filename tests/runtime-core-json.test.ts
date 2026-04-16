import { describe, expect, it } from 'vitest'

import { utf8ByteLength } from '../src/runtime/core/bytes.js'
import {
  parseJsonArray,
  parseJsonArrayBody,
  parseJsonObject,
  parseJsonObjectBody,
} from '../src/runtime/core/json.js'

describe('runtime core json helpers', () => {
  it('parses object and array json without throwing', () => {
    expect(parseJsonObject('{"a":1,"nested":{"b":true}}')).toEqual({
      ok: true,
      value: { a: 1, nested: { b: true } },
    })

    expect(parseJsonArray('["a",1,{"b":false}]')).toEqual({
      ok: true,
      value: ['a', 1, { b: false }],
    })
  })

  it('returns explicit codes for invalid json and wrong root shapes', () => {
    expect(parseJsonObject('{')).toMatchObject({
      ok: false,
      code: 'json_invalid_syntax',
    })

    expect(parseJsonObject('["a"]')).toMatchObject({
      ok: false,
      code: 'json_not_object',
    })

    expect(parseJsonArray('{"a":1}')).toMatchObject({
      ok: false,
      code: 'json_not_array',
    })
  })

  it('enforces byte limits before parsing body json', () => {
    const body = '{"emoji":"😀"}'
    const limitBytes = utf8ByteLength(body)

    expect(parseJsonObjectBody(body, limitBytes)).toEqual({
      ok: true,
      value: { emoji: '😀' },
    })

    expect(parseJsonObjectBody(body, limitBytes - 1)).toMatchObject({
      ok: false,
      code: 'json_body_too_large',
      limitBytes: limitBytes - 1,
      actualBytes: limitBytes,
    })

    expect(parseJsonArrayBody('[1,2,3]', 0)).toMatchObject({
      ok: false,
      code: 'json_body_too_large',
    })
  })

  it('rejects invalid byte limits deterministically', () => {
    expect(parseJsonObjectBody('{}', Number.NaN)).toMatchObject({
      ok: false,
      code: 'json_invalid_limit',
    })

    expect(parseJsonArrayBody('[]', -1)).toMatchObject({
      ok: false,
      code: 'json_invalid_limit',
    })
  })
})
