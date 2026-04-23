import type { ValidationResult } from './dnsTxtParser.js'

export type DmSignatureErrorCode =
  | 'sig_invalid_payload'
  | 'sig_invalid_public_key'
  | 'sig_invalid_signature_encoding'
  | 'sig_unsupported_algorithm'
  | 'sig_window_not_started'
  | 'sig_window_expired'
  | 'sig_verification_failed'

export interface DmConfigSignatureBlock {
  v: 'dm1'
  domain: string
  owner: string
  validFrom: number
  validTo: number
  nonce: string
  sigAlg: string
  sig: string
  publicKey?: string | Uint8Array
}

export interface VerifyDmConfigSignatureOptions {
  publicKey?: string | Uint8Array
  now?: number
}

type VerifyResult<T> = ValidationResult<T, DmSignatureErrorCode>

const SUPPORTED_SIGNATURE_VERIFIERS: Record<
  string,
  (payload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => Promise<boolean>
> = {
  ed25519: verifyEd25519Signature,
  'rsa-pss-sha256': verifyRsaPssSha256Signature
}

function fail(code: DmSignatureErrorCode, message: string, field?: string): VerifyResult<never> {
  return { ok: false, error: { code, message, field } }
}

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function base64UrlToBytes(input: string): Uint8Array | null {
  if (!input || !/^[A-Za-z0-9+/_=-]+$/.test(input)) {
    return null
  }

  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const paddingLength = (4 - (normalized.length % 4 || 4)) % 4
  const padded = normalized + '='.repeat(paddingLength)

  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

function normalizePublicKey(publicKey: string | Uint8Array): Uint8Array | null {
  if (publicKey instanceof Uint8Array) {
    return publicKey.byteLength > 0 ? publicKey : null
  }
  return base64UrlToBytes(publicKey)
}

function resolvePublicKey(config: DmConfigSignatureBlock, options: VerifyDmConfigSignatureOptions): Uint8Array | null {
  const source = options.publicKey ?? config.publicKey
  if (!source) {
    return null
  }
  return normalizePublicKey(source)
}

export function buildDm1SignaturePayload(config: DmConfigSignatureBlock): VerifyResult<string> {
  if (!config.domain || !config.owner || !config.nonce) {
    return fail('sig_invalid_payload', 'domain, owner and nonce are required in signature payload.')
  }

  const canonicalPayload =
    `{"domain":${JSON.stringify(config.domain)},` +
    `"nonce":${JSON.stringify(config.nonce)},` +
    `"owner":${JSON.stringify(config.owner)},` +
    `"sigAlg":${JSON.stringify(config.sigAlg)},` +
    `"v":"dm1",` +
    `"validFrom":${config.validFrom},` +
    `"validTo":${config.validTo}}`

  return { ok: true, value: canonicalPayload }
}

async function importEd25519PublicKey(publicKey: Uint8Array): Promise<CryptoKey | null> {
  if (publicKey.byteLength === 32) {
    try {
      return await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify'])
    } catch {
      // Continue with spki fallback.
    }
  }

  try {
    return await crypto.subtle.importKey('spki', publicKey, 'Ed25519', false, ['verify'])
  } catch {
    return null
  }
}

async function verifyEd25519Signature(
  payload: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  const key = await importEd25519PublicKey(publicKey)
  if (!key) {
    return false
  }

  try {
    return await crypto.subtle.verify('Ed25519', key, signature, payload)
  } catch {
    return false
  }
}

async function importRsaPssPublicKey(publicKey: Uint8Array): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey(
      'spki',
      publicKey,
      {
        name: 'RSA-PSS',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    )
  } catch {
    return null
  }
}

async function verifyRsaPssSha256Signature(
  payload: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  const key = await importRsaPssPublicKey(publicKey)
  if (!key) {
    return false
  }

  try {
    return await crypto.subtle.verify(
      {
        name: 'RSA-PSS',
        saltLength: 32
      },
      key,
      signature,
      payload
    )
  } catch {
    return false
  }
}

export async function verifyDmConfigSignature(
  config: DmConfigSignatureBlock,
  options: VerifyDmConfigSignatureOptions
): Promise<VerifyResult<{ payload: string }>> {
  const verifier = SUPPORTED_SIGNATURE_VERIFIERS[config.sigAlg]
  if (!verifier) {
    return fail(
      'sig_unsupported_algorithm',
      `Unsupported signature algorithm: ${config.sigAlg}.`,
      'sigAlg'
    )
  }

  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (now < config.validFrom) {
    return fail('sig_window_not_started', 'Config is not yet valid.', 'validFrom')
  }
  if (now > config.validTo) {
    return fail('sig_window_expired', 'Config validity window has expired.', 'validTo')
  }

  const payloadResult = buildDm1SignaturePayload(config)
  if (!payloadResult.ok) {
    return payloadResult
  }

  const publicKeyBytes = resolvePublicKey(config, options)
  if (!publicKeyBytes) {
    return fail(
      'sig_invalid_public_key',
      'Public key is invalid, empty, or missing in config/options.',
      'publicKey'
    )
  }

  const signatureBytes = base64UrlToBytes(config.sig)
  if (!signatureBytes) {
    return fail(
      'sig_invalid_signature_encoding',
      'Signature must be a base64/base64url-encoded string.',
      'sig'
    )
  }

  const verified = await verifier(toBytes(payloadResult.value), signatureBytes, publicKeyBytes)
  if (!verified) {
    return fail('sig_verification_failed', 'Signature verification failed.', 'sig')
  }

  return { ok: true, value: { payload: payloadResult.value } }
}
