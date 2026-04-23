import { describe, expect, it } from 'vitest'
import {
  parseAndValidateDmTxtEnvelope,
  parseDmTxtPayload,
  validateDmTxtEnvelope
} from '../src/dnsTxtParser.js'
import {
  canonicalizeDomain,
  validateConfigKidAgainstTxt,
  validateDmConfigJson
} from '../src/configValidator.js'

function sampleConfig(overrides: Record<string, unknown> = {}) {
  return {
    v: 'dm1',
    domain: 'EXAMPLE.com',
    siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
    writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
    entryPath: '/',
    validFrom: 1760000000,
    validTo: 1790000000,
    sigAlg: 'rsa-pss-sha256',
    sig: 'a'.repeat(64),
    owner: 'OwnerAddress_123456789012345678901234567890AB',
    nonce: 'nonce-123',
    ...overrides
  }
}

describe('dns TXT parser', () => {
  it('parses and validates dm1 TXT envelope', () => {
    const result = parseAndValidateDmTxtEnvelope(
      'v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ;ttl=3600'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.v).toBe('dm1')
    expect(result.value.ttl).toBe(3600)
  })

  it('returns explicit error for invalid TTL', () => {
    const parsed = parseDmTxtPayload(
      'v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ;ttl=abc'
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const result = validateDmTxtEnvelope(parsed.value)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('txt_invalid_ttl')
  })

  it('returns explicit error for missing field', () => {
    const result = parseAndValidateDmTxtEnvelope('v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;ttl=3600')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('txt_missing_field')
  })
})

describe('domain canonicalization', () => {
  it('normalizes unicode and uppercase domain to punycode lowercase', () => {
    const result = canonicalizeDomain('Česká.cz')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe('xn--esk-gla0t.cz')
  })

  it('rejects domain with path', () => {
    const result = canonicalizeDomain('example.com/path')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('domain_invalid')
  })
})

describe('DM config validator', () => {
  it('validates and normalizes config payload', () => {
    const result = validateDmConfigJson(sampleConfig())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.domain).toBe('example.com')
    expect(result.value.sigAlg).toBe('rsa-pss-sha256')
  })

  it('returns explicit error when validity window is inverted', () => {
    const result = validateDmConfigJson(
      sampleConfig({
        validFrom: 200,
        validTo: 100
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('config_invalid_time_window')
  })

  it('returns explicit error for missing required field', () => {
    const payload = sampleConfig()
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (payload as Record<string, unknown>).siteProcess

    const result = validateDmConfigJson(payload)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('config_missing_field')
  })

  it('validates kid binding between TXT and config', () => {
    const cfgResult = validateDmConfigJson(sampleConfig({ kid: 'KidAddress_123456789012345678901234567890AB' }))
    expect(cfgResult.ok).toBe(true)
    if (!cfgResult.ok) return

    const txtResult = parseAndValidateDmTxtEnvelope(
      'v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=DifferentKid_123456789012345678901234567890AB;ttl=600'
    )
    expect(txtResult.ok).toBe(true)
    if (!txtResult.ok) return

    const bound = validateConfigKidAgainstTxt(cfgResult.value, txtResult.value)
    expect(bound.ok).toBe(false)
    if (bound.ok) return
    expect(bound.error.code).toBe('config_kid_mismatch')
  })
})
