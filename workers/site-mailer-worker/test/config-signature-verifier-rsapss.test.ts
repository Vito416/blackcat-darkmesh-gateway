import { describe, expect, it } from 'vitest'
import {
  buildDm1SignaturePayload,
  verifyDmConfigSignature
} from '../src/configSignatureVerifier.js'

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

async function createRsaSignedConfig(overrides: Record<string, unknown> = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )

  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))

  const unsignedConfig = {
    v: 'dm1' as const,
    domain: 'example.com',
    owner: 'owner_wallet_address_1234567890123456789012345',
    validFrom: 1760000000,
    validTo: 1790000000,
    nonce: 'nonce-rsapss-1',
    sigAlg: 'rsa-pss-sha256',
    sig: '',
    publicKey: bytesToBase64Url(publicKeySpki),
    ...overrides
  }

  const payloadResult = buildDm1SignaturePayload(unsignedConfig)
  if (!payloadResult.ok) {
    throw new Error(`Failed to build signature payload: ${payloadResult.error.code}`)
  }

  const signature = await crypto.subtle.sign(
    {
      name: 'RSA-PSS',
      saltLength: 32
    },
    keyPair.privateKey,
    textToBytes(payloadResult.value)
  )

  return {
    config: {
      ...unsignedConfig,
      sig: bytesToBase64Url(new Uint8Array(signature))
    }
  }
}

describe('config signature verifier (rsa-pss-sha256)', () => {
  it('verifies valid RSA-PSS signature using config-embedded public key', async () => {
    const { config } = await createRsaSignedConfig()
    const result = await verifyDmConfigSignature(config, {
      now: 1770000000
    })

    expect(result.ok).toBe(true)
  })

  it('returns deterministic failure for invalid RSA-PSS signature', async () => {
    const { config } = await createRsaSignedConfig()
    const tampered = { ...config, owner: 'attacker_wallet_12345678901234567890' }
    const result = await verifyDmConfigSignature(tampered, {
      now: 1770000000
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('sig_verification_failed')
  })

  it('returns deterministic failure for malformed RSA public key material', async () => {
    const { config } = await createRsaSignedConfig({
      publicKey: 'not@@base64'
    })

    const result = await verifyDmConfigSignature(config, {
      now: 1770000000
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('sig_invalid_public_key')
  })
})

