import { describe, expect, it } from 'vitest'
import { parseAndValidateDmTxtEnvelope } from '../src/dnsTxtParser.js'
import { validateConfigKidAgainstTxt, validateDmConfigJson } from '../src/configValidator.js'

function cfg(overrides: Record<string, unknown> = {}) {
  return {
    v: 'dm1',
    domain: 'example.com',
    siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
    writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
    entryPath: '/',
    validFrom: 1760000000,
    validTo: 1790000000,
    sigAlg: 'rsa-pss-sha256',
    sig: 'a'.repeat(64),
    ...overrides
  }
}

describe('site-mailer adversarial parsing/validation', () => {
  it('rejects TXT key injection via duplicate key', () => {
    const txt =
      'v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ;ttl=3600;ttl=7200'

    const result = parseAndValidateDmTxtEnvelope(txt)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('txt_duplicate_key')
  })

  it('rejects TXT unknown key injection', () => {
    const txt =
      'v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ;ttl=3600;role=admin'

    const result = parseAndValidateDmTxtEnvelope(txt)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('txt_unknown_key')
  })

  it('rejects TXT cfg overflow beyond accepted id length', () => {
    const tooLongCfg = 'A'.repeat(129)
    const txt = `v=dm1;cfg=${tooLongCfg};kid=ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ;ttl=3600`

    const result = parseAndValidateDmTxtEnvelope(txt)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('txt_invalid_cfg')
  })

  it('rejects config signature tampering with invalid signature format', () => {
    const result = validateDmConfigJson(cfg({ sig: '!!!!tampered!!!!' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('config_invalid_field')
    expect(result.error.field).toBe('sig')
  })

  it('rejects config kid mismatch against validated TXT envelope', () => {
    const txt = parseAndValidateDmTxtEnvelope(
      'v=dm1;cfg=AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC;kid=DifferentKid_123456789012345678901234567890AB;ttl=600'
    )
    expect(txt.ok).toBe(true)
    if (!txt.ok) return

    const bound = validateConfigKidAgainstTxt(
      {
        v: 'dm1',
        domain: 'example.com',
        siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
        writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
        entryPath: '/',
        validFrom: 1760000000,
        validTo: 1790000000,
        sigAlg: 'rsa-pss-sha256',
        sig: 'a'.repeat(64),
        kid: 'KidAddress_123456789012345678901234567890AB'
      },
      txt.value
    )
    expect(bound.ok).toBe(false)
    if (bound.ok) return
    expect(bound.error.code).toBe('config_kid_mismatch')
  })
})
