import { describe, expect, it } from 'vitest'
import { validateCreatePaymentIntentPayload } from '../src/runtime/payments/validators.js'

describe('runtime payments validators', () => {
  it('accepts a valid create payment intent payload', () => {
    expect(
      validateCreatePaymentIntentPayload({
        orderId: 'order-123',
        provider: 'stripe',
      }),
    ).toEqual({ ok: true })
  })

  it('rejects payloads with unsupported providers', () => {
    expect(
      validateCreatePaymentIntentPayload({
        orderId: 'order-123',
        provider: 'square',
      }),
    ).toEqual({ ok: false, error: 'payload.provider must be stripe|paypal|gopay' })
  })

  it('accepts provider values case-insensitively', () => {
    expect(
      validateCreatePaymentIntentPayload({
        orderId: 'order-123',
        provider: 'PaYPal',
      }),
    ).toEqual({ ok: true })
  })

  it('rejects malformed payloads', () => {
    expect(validateCreatePaymentIntentPayload(null)).toEqual({
      ok: false,
      error: 'payload must be an object',
    })
  })
})
