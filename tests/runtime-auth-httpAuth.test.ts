import { describe, expect, it } from 'vitest'
import { basicCredentialsMatch, checkToken, tokenEquals } from '../src/runtime/auth/httpAuth.js'

describe('runtime auth http helpers', () => {
  it('returns false when token lengths do not match', () => {
    expect(tokenEquals('abcd', 'abc')).toBe(false)
    expect(tokenEquals('abc', 'abcd')).toBe(false)
  })

  it('rejects malformed basic auth payloads', () => {
    expect(basicCredentialsMatch('user', 'pass', 'Basic not-base64')).toBe(false)
    expect(basicCredentialsMatch('user', 'pass', 'Basic dXNlcnBhc3M=')).toBe(false)
    expect(basicCredentialsMatch('user', 'pass', '')).toBe(false)
  })

  it('accepts bearer and header fallback tokens', () => {
    const bearerReq = new Request('http://gateway', {
      headers: { authorization: 'Bearer token-123' },
    })
    const headerReq = new Request('http://gateway', {
      headers: { 'x-custom-token': 'token-123' },
    })
    const wrongReq = new Request('http://gateway', {
      headers: { authorization: 'Bearer nope', 'x-custom-token': 'still-nope' },
    })

    expect(checkToken(bearerReq, 'token-123', 'x-custom-token')).toBe(true)
    expect(checkToken(headerReq, 'token-123', 'x-custom-token')).toBe(true)
    expect(checkToken(wrongReq, 'token-123', 'x-custom-token')).toBe(false)
  })
})
