import { describe, expect, it } from 'vitest'
import {
  buildDm1SignaturePayload,
  verifyDmConfigSignature
} from '../src/configSignatureVerifier.js'
import { validateAndVerifyDmConfig } from '../src/configValidator.js'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

async function createSignedConfig(overrides: Record<string, unknown> = {}) {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))

  const unsignedConfig = {
    v: 'dm1' as const,
    domain: 'example.com',
    owner: 'owner_wallet_address_1234567890123456789012345',
    validFrom: 1760000000,
    validTo: 1790000000,
    nonce: 'nonce-123',
    sigAlg: 'ed25519',
    sig: '',
    siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
    writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
    entryPath: '/',
    ...overrides
  }

  const payloadResult = buildDm1SignaturePayload(unsignedConfig)
  if (!payloadResult.ok) {
    throw new Error(`Failed to build signing payload: ${payloadResult.error.code}`)
  }

  const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, textToBytes(payloadResult.value))
  const sig = bytesToBase64Url(new Uint8Array(signature))

  return {
    config: { ...unsignedConfig, sig },
    publicKey: bytesToBase64Url(publicKeyRaw)
  }
}

describe('config signature verifier', () => {
  it('verifies valid ed25519 signature', async () => {
    const { config, publicKey } = await createSignedConfig()
    const result = await verifyDmConfigSignature(config, {
      publicKey,
      now: 1770000000
    })

    expect(result.ok).toBe(true)
  })

  it('fails verification when signed fields are modified', async () => {
    const { config, publicKey } = await createSignedConfig()
    const tamperedConfig = { ...config, domain: 'evil.example.com' }

    const result = await verifyDmConfigSignature(tamperedConfig, {
      publicKey,
      now: 1770000000
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('sig_verification_failed')
  })

  it('enforces valid time window checks', async () => {
    const { config, publicKey } = await createSignedConfig()
    const beforeStart = await verifyDmConfigSignature(config, {
      publicKey,
      now: config.validFrom - 1
    })
    expect(beforeStart.ok).toBe(false)
    if (!beforeStart.ok) {
      expect(beforeStart.error.code).toBe('sig_window_not_started')
    }

    const expired = await verifyDmConfigSignature(config, {
      publicKey,
      now: config.validTo + 1
    })
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.error.code).toBe('sig_window_expired')
    }
  })

  it('rejects unsupported signature algorithms', async () => {
    const { config, publicKey } = await createSignedConfig({ sigAlg: 'ed448' })
    const result = await verifyDmConfigSignature(config, {
      publicKey,
      now: 1770000000
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('sig_unsupported_algorithm')
  })

  it('allows validator to verify signatures in one step', async () => {
    const { config, publicKey } = await createSignedConfig()
    const result = await validateAndVerifyDmConfig(config, {
      publicKey,
      now: 1770000000
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.domain).toBe('example.com')
  })
})
