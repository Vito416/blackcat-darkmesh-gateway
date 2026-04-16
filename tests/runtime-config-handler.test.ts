import { describe, expect, it } from 'vitest'
import {
  readForgetToken,
  readHandlerStrictEnabledFlag,
  readIntegrityIncidentAuthConfig,
  readIntegrityStateToken,
  readPositiveIntEnv,
  readTemplateToken,
  readWebhookConfig,
  readWorkerNotifyConfig,
  resolveWorkerNotifyBreakerKey,
} from '../src/runtime/config/handlerConfig.js'

describe('runtime config handler helpers', () => {
  it('keeps token readers defaulted and trims explicit values', () => {
    expect(readTemplateToken()).toBeUndefined()
    expect(readTemplateToken({ GATEWAY_TEMPLATE_TOKEN: '  template-token  ' })).toBe('template-token')

    expect(readForgetToken()).toBeUndefined()
    expect(readForgetToken({ GATEWAY_FORGET_TOKEN: '  forget-token  ' })).toBe('forget-token')

    expect(readIntegrityStateToken()).toBe('')
    expect(readIntegrityStateToken({ GATEWAY_INTEGRITY_STATE_TOKEN: '  state-token  ' })).toBe('state-token')

    expect(readIntegrityIncidentAuthConfig()).toEqual({
      token: '',
      requireSignatureRef: false,
      refHeaderName: 'x-signature-ref',
      roleRefs: {
        root: [],
        upgrade: [],
        emergency: [],
        reporter: [],
      },
      notify: {
        url: undefined,
        token: undefined,
        hmac: undefined,
      },
    })
  })

  it('treats strict flags as enabled only for trimmed 1', () => {
    expect(readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_POLICY_PAUSED', { GATEWAY_INTEGRITY_POLICY_PAUSED: '1' })).toBe(
      true,
    )
    expect(readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_POLICY_PAUSED', { GATEWAY_INTEGRITY_POLICY_PAUSED: ' 1 ' })).toBe(
      true,
    )
    expect(readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_POLICY_PAUSED', { GATEWAY_INTEGRITY_POLICY_PAUSED: '0' })).toBe(
      false,
    )
    expect(
      readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_POLICY_PAUSED', { GATEWAY_INTEGRITY_POLICY_PAUSED: 'true' }),
    ).toBe(false)
    expect(readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_POLICY_PAUSED')).toBe(false)
  })

  it('parses positive integers and falls back on missing, zero, negative, or invalid input', () => {
    expect(readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', 262144, { GATEWAY_WEBHOOK_MAX_BODY_BYTES: ' 1024 ' })).toBe(
      1024,
    )
    expect(readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', 262144, {})).toBe(262144)
    expect(readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', 262144, { GATEWAY_WEBHOOK_MAX_BODY_BYTES: '0' })).toBe(
      262144,
    )
    expect(readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', 262144, { GATEWAY_WEBHOOK_MAX_BODY_BYTES: '-9' })).toBe(
      262144,
    )
    expect(readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', 262144, { GATEWAY_WEBHOOK_MAX_BODY_BYTES: 'abc' })).toBe(
      262144,
    )
  })

  it('normalizes integrity role refs CSV entries and trims incident auth config fields', () => {
    const config = readIntegrityIncidentAuthConfig({
      GATEWAY_INTEGRITY_INCIDENT_TOKEN: '  incident-token  ',
      GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF: '1',
      GATEWAY_INTEGRITY_INCIDENT_REF_HEADER: '  x-custom-signature-ref  ',
      GATEWAY_INTEGRITY_ROLE_ROOT_REFS: '  root-a , root-b ,, root-c  ',
      GATEWAY_INTEGRITY_ROLE_UPGRADE_REFS: ' upgrade-a,upgrade-b ',
      GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS: ' emergency-a , , emergency-b ',
      GATEWAY_INTEGRITY_ROLE_REPORTER_REFS: ' reporter-a, reporter-b , ',
      GATEWAY_INTEGRITY_INCIDENT_NOTIFY_URL: '  https://notify.example.test/hook  ',
      GATEWAY_INTEGRITY_INCIDENT_NOTIFY_TOKEN: '  notify-token  ',
      GATEWAY_INTEGRITY_INCIDENT_NOTIFY_HMAC: '  notify-hmac  ',
    })

    expect(config).toEqual({
      token: 'incident-token',
      requireSignatureRef: true,
      refHeaderName: 'x-custom-signature-ref',
      roleRefs: {
        root: ['root-a', 'root-b', 'root-c'],
        upgrade: ['upgrade-a', 'upgrade-b'],
        emergency: ['emergency-a', 'emergency-b'],
        reporter: ['reporter-a', 'reporter-b'],
      },
      notify: {
        url: 'https://notify.example.test/hook',
        token: 'notify-token',
        hmac: 'notify-hmac',
      },
    })
  })

  it('applies webhook config defaults when env vars are absent', () => {
    expect(readWebhookConfig(262144)).toEqual({
      maxBodyBytes: 262144,
      shadowInvalid: false,
      stripeSecret: '',
      stripeToleranceMs: 300000,
      paypalWebhookSecret: undefined,
      gopayWebhookSecret: '',
    })
  })

  it('clamps stripe webhook tolerance within safe bounds', () => {
    expect(readWebhookConfig(262144, { STRIPE_WEBHOOK_TOLERANCE_MS: '999' }).stripeToleranceMs).toBe(1000)
    expect(readWebhookConfig(262144, { STRIPE_WEBHOOK_TOLERANCE_MS: '700000' }).stripeToleranceMs).toBe(600000)
    expect(readWebhookConfig(262144, { STRIPE_WEBHOOK_TOLERANCE_MS: 'invalid' }).stripeToleranceMs).toBe(300000)
  })

  it('returns worker notify defaults and resolves breaker keys by provider precedence', () => {
    const defaults = readWorkerNotifyConfig()

    expect(defaults).toEqual({
      target: 'http://localhost:8787/notify',
      token: '',
      hmacSecret: '',
      breakerKey: undefined,
      breakerKeyStripe: undefined,
      breakerKeyPaypal: undefined,
      breakerKeyGopay: undefined,
    })

    const keyed = {
      ...defaults,
      breakerKey: 'gateway-key',
      breakerKeyStripe: 'stripe-key',
      breakerKeyPaypal: 'paypal-key',
      breakerKeyGopay: 'gopay-key',
    }

    expect(resolveWorkerNotifyBreakerKey(keyed, 'stripe')).toBe('stripe-key')
    expect(resolveWorkerNotifyBreakerKey(keyed, 'paypal')).toBe('paypal-key')
    expect(resolveWorkerNotifyBreakerKey(keyed, 'gopay')).toBe('gopay-key')
    expect(resolveWorkerNotifyBreakerKey(keyed, 'square')).toBe('gateway-key')
    expect(resolveWorkerNotifyBreakerKey(defaults, 'square')).toBe('square')
    expect(resolveWorkerNotifyBreakerKey(defaults)).toBe('gateway')
  })
})
