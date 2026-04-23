import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'
import { buildDm1SignaturePayload } from '../src/configSignatureVerifier.js'

const AUTH_TOKEN = 'test-internal-token'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

async function createSignedConfig(domain: string, cfgTx: string) {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const kid = bytesToBase64Url(publicKeyRaw)
  const now = Math.floor(Date.now() / 1000)

  const unsignedConfig = {
    v: 'dm1' as const,
    domain,
    owner: kid,
    validFrom: now - 60,
    validTo: now + 3600,
    nonce: 'nonce-test',
    sigAlg: 'ed25519',
    sig: '',
    siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
    writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
    entryPath: '/'
  }

  const payloadResult = buildDm1SignaturePayload(unsignedConfig)
  if (!payloadResult.ok) {
    throw new Error(`Failed to build payload: ${payloadResult.error.code}`)
  }

  const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, textToBytes(payloadResult.value))
  const sig = bytesToBase64Url(new Uint8Array(signature))

  return {
    txtPayload: `v=dm1;cfg=${cfgTx};kid=${kid};ttl=600`,
    config: { ...unsignedConfig, sig }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('refresh signature integration', () => {
  it('passes with valid signed config in strict mode', async () => {
    const bundle = await createSignedConfig('example.com', 'a'.repeat(43))
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const res = await worker.request(
      'http://example.test/jobs/refresh-domain',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          domain: 'example.com',
          txtPayload: bundle.txtPayload,
          configJson: bundle.config,
          hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
        })
      },
      {
        MAILER_AUTH_TOKEN: AUTH_TOKEN,
        REFRESH_SIGNATURE_STRICT: '1',
        HB_PROBE_ALLOWLIST: 'hyperbeam.darkmesh.fun'
      }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.hbProbe.status).toBe('ok')
  })

  it('fails with deterministic code for tampered signature in strict mode', async () => {
    const bundle = await createSignedConfig('example.com', 'b'.repeat(43))
    const tampered = { ...bundle.config, nonce: 'tampered' }
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const res = await worker.request(
      'http://example.test/jobs/refresh-domain',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          domain: 'example.com',
          txtPayload: bundle.txtPayload,
          configJson: tampered,
          hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
        })
      },
      {
        MAILER_AUTH_TOKEN: AUTH_TOKEN,
        REFRESH_SIGNATURE_STRICT: '1',
        HB_PROBE_ALLOWLIST: 'hyperbeam.darkmesh.fun'
      }
    )

    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toBe('sig_verification_failed')
    // Signature failure should stop before HB probe.
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('supports strict-mode toggle (fail-open when disabled)', async () => {
    const bundle = await createSignedConfig('example.com', 'c'.repeat(43))
    const tampered = { ...bundle.config, nonce: 'tampered' }
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const res = await worker.request(
      'http://example.test/jobs/refresh-domain',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          domain: 'example.com',
          txtPayload: bundle.txtPayload,
          configJson: tampered,
          hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
        })
      },
      {
        MAILER_AUTH_TOKEN: AUTH_TOKEN,
        REFRESH_SIGNATURE_STRICT: '0',
        HB_PROBE_ALLOWLIST: 'hyperbeam.darkmesh.fun'
      }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.hbProbe.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
