import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { getRuntimeCryptoBoundaryEvidence } from '../src/runtime/crypto/boundary.js'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const cryptoSources = [
  'src/runtime/crypto/boundary.ts',
  'src/runtime/crypto/hmac.ts',
  'src/runtime/crypto/safeCompare.ts',
  'src/runtime/crypto/signatureRefs.ts',
  'src/webhooks.ts',
]

const forbiddenCryptoSigningPatterns = [
  /wallet\.json/i,
  /\bprivateKey\b/i,
  /BEGIN PRIVATE KEY/i,
  /\bseed phrase\b/i,
  /\bmnemonic\b/i,
  /\bed25519\b/i,
  /\bsignMessage\b/i,
  /\bsigningKey\b/i,
  /\bsecp256k1\b/i,
]

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8')
}

describe('runtime crypto boundary evidence', () => {
  it('declares a verification-only boundary with no request-path signing capability', () => {
    expect(getRuntimeCryptoBoundaryEvidence()).toEqual({
      mode: 'verification-only',
      requestPathSigning: false,
      walletSigning: false,
      privateKeySigning: false,
      verificationHelpers: [
        'safeCompareAscii',
        'safeCompareHexOrAscii',
        'verifyHmacSignature',
        'normalizeSignatureRefList',
        'validateSignatureRefList',
        'validateExpectedSignatureRefs',
        'signatureRefListsOverlap',
      ],
      forbiddenCapabilities: [
        'wallet signing',
        'private-key signing',
        'request-path key derivation',
        'request-path signing',
      ],
    })
  })

  it('keeps private-key and wallet signing references out of the runtime crypto boundary', () => {
    for (const relativePath of cryptoSources) {
      const source = readSource(relativePath)
      for (const pattern of forbiddenCryptoSigningPatterns) {
        expect(source, `${relativePath} matched ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('keeps the HMAC webhook short-path local to the request path', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { verifyPayPal } = await import('../src/webhooks.js')
    const body = JSON.stringify({ id: 'WH-local', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
    const secret = 'ppsecret'
    const transmissionId = 'tx-local-1'
    const transmissionTime = '2026-04-09T00:00:00Z'
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${transmissionId}.${transmissionTime}.${body}`)
      .digest('hex')
    const headers = new Headers({
      'PayPal-Transmission-Sig': signature,
      'PayPal-Transmission-Id': transmissionId,
      'PayPal-Transmission-Time': transmissionTime,
      'PayPal-Cert-Url': 'https://api.paypal.com/certs/wh.pem',
    })

    const result = await verifyPayPal(body, headers, secret)

    expect(result).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
