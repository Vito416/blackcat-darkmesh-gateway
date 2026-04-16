import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectTemplateSecretPayload } from '../src/runtime/template/secretGuard.js'

describe('runtime template secret guard', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('blocks nested secret-like fields by default', () => {
    const result = inspectTemplateSecretPayload({
      siteId: 'site-1',
      payment: {
        provider: 'stripe',
        customer: {
          apiKey: 'secret-value',
        },
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('payload_contains_forbidden_secret_fields')
      expect(result.detail.forbiddenFields).toEqual(['payload.payment.customer.apiKey'])
    }
  })

  it('allows safe payload fields', () => {
    const result = inspectTemplateSecretPayload({
      siteId: 'site-1',
      paymentId: 'pay-123',
      provider: 'stripe',
      customer: {
        email: 'customer@example.com',
      },
      items: [{ sku: 'sku-1', qty: 1 }],
    })

    expect(result).toEqual({ ok: true })
  })

  it('allows exact allowlisted keys', () => {
    process.env.GATEWAY_TEMPLATE_SECRET_GUARD_ALLOWLIST = 'smtpConfig,walletJwk'

    const result = inspectTemplateSecretPayload({
      siteId: 'site-1',
      smtpConfig: {
        host: 'smtp.example',
      },
      walletJwk: {
        kty: 'OKP',
      },
    })

    expect(result).toEqual({ ok: true })
  })

  it('can be disabled with the strict toggle', () => {
    process.env.GATEWAY_TEMPLATE_SECRET_GUARD_STRICT = '0'

    const result = inspectTemplateSecretPayload({
      siteId: 'site-1',
      smtp: {
        password: 'super-secret',
      },
    })

    expect(result).toEqual({ ok: true })
  })
})
