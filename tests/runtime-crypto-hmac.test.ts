import { describe, expect, it } from 'vitest'
import crypto from 'crypto'

import { verifyHmacSignature } from '../src/runtime/crypto/hmac.js'

describe('runtime crypto HMAC helpers', () => {
  it('verifies sha256 signatures with or without a prefix', () => {
    const body = JSON.stringify({ id: 'event-ok', amount: 1000 })
    const secret = 'gopay_test_secret'
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')

    expect(verifyHmacSignature(body, signature, secret, { algorithm: 'sha256', digestEncoding: 'hex' })).toBe(true)
    expect(
      verifyHmacSignature(body, ` sha256=${signature} `, secret, {
        algorithm: 'sha256',
        digestEncoding: 'hex',
        prefix: 'sha256=',
      }),
    ).toBe(true)
  })

  it('fails closed for invalid inputs without throwing', () => {
    expect(() => verifyHmacSignature(null, null, null)).not.toThrow()
    expect(verifyHmacSignature(null, null, null)).toBe(false)
    expect(verifyHmacSignature('', 'sha256=', '')).toBe(false)
    expect(verifyHmacSignature('body', 'bad-signature', 'secret', { algorithm: 'sha256' })).toBe(false)
  })

  it('rejects altered payloads deterministically', () => {
    const body = JSON.stringify({ id: 'event-ok', status: 'PAID' })
    const secret = 'gopay_test_secret'
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')

    expect(
      verifyHmacSignature(`${body} `, signature, secret, {
        algorithm: 'sha256',
        digestEncoding: 'hex',
      }),
    ).toBe(false)
  })
})
