import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'
import { buildDm1SignaturePayload } from '../src/configSignatureVerifier.js'
import { parseDomainMapEntry } from '../src/domainMapStore.js'

const AUTH_TOKEN = 'test-internal-token'

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

async function createSignedConfigBundle(domain: string, cfgTx: string) {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const kid = bytesToBase64Url(publicKeyRaw)
  const now = Math.floor(Date.now() / 1000)

  const unsignedConfig = {
    v: 'dm1' as const,
    domain,
    owner: kid,
    validFrom: now - 120,
    validTo: now + 3600,
    nonce: `nonce-${domain}`,
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
    kid,
    txtPayload: `v=dm1;cfg=${cfgTx};kid=${kid};ttl=3600`,
    config: { ...unsignedConfig, sig }
  }
}

const baseEnv = {
  MAILER_AUTH_TOKEN: AUTH_TOKEN,
  REFRESH_SIGNATURE_STRICT: '1',
  HB_PROBE_ALLOWLIST: 'hyperbeam.darkmesh.fun'
}

function createDomainMapKv() {
  const storage = new Map<string, string>()
  return {
    storage,
    kv: {
      async get(key: string) {
        return storage.get(key) ?? null
      },
      async put(key: string, value: string) {
        storage.set(key, value)
      },
      async delete(key: string) {
        storage.delete(key)
      },
      async list({ prefix = '' }: { prefix?: string } = {}) {
        return {
          keys: [...storage.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
          list_complete: true
        }
      }
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('refresh jobs', () => {
  it('rejects unauthorized refresh-domain requests', async () => {
    const res = await worker.request('http://example.test/jobs/refresh-domain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com' })
    }, baseEnv)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns controlled validation error for invalid domain', async () => {
    const res = await worker.request(
      'http://example.test/jobs/refresh-domain',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ domain: 'invalid_domain' })
      },
      baseEnv
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('domain_invalid')
  })

  it('runs refresh-domain inline with hb probe', async () => {
    const cfgTx = 'a'.repeat(43)
    const signed = await createSignedConfigBundle('example.com', cfgTx)
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
          txtPayload: signed.txtPayload,
          configJson: signed.config,
          hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
        })
      },
      baseEnv
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.domain).toBe('example.com')
    expect(body.hbProbe.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts enqueue contract and uses queue binding when available', async () => {
    const send = vi.fn(async () => undefined)
    const env = {
      ...baseEnv,
      DOMAIN_REFRESH_QUEUE: { send }
    }

    const res = await worker.request(
      'http://example.test/jobs/enqueue',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          type: 'refresh-domain',
          payload: {
            domain: 'example.com',
            reason: 'test'
          }
        })
      },
      env
    )

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('queue')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('runs batch refresh with dedupe guard for duplicate domains', async () => {
    const first = await createSignedConfigBundle('example.com', 'a'.repeat(43))
    const second = await createSignedConfigBundle('second.com', 'b'.repeat(43))
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const res = await worker.request(
      'http://example.test/jobs/refresh-domain/batch',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          items: [
            {
              domain: 'example.com',
              txtPayload: first.txtPayload,
              configJson: first.config,
              hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
            },
            {
              domain: 'example.com',
              txtPayload: first.txtPayload,
              configJson: first.config,
              hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
            },
            {
              domain: 'second.com',
              txtPayload: second.txtPayload,
              configJson: second.config,
              hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
            }
          ]
        })
      },
      baseEnv
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('batch')
    expect(body.attempted).toBe(2)
    expect(body.okCount).toBe(2)
    expect(body.failedCount).toBe(0)
    expect(body.duplicates).toEqual(['example.com'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('scheduled handler triggers refresh batch flow', async () => {
    const cfgTx = 'c'.repeat(43)
    const signed = await createSignedConfigBundle('alpha.example', cfgTx)

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://dns.google/resolve')) {
        return new Response(
          JSON.stringify({
            Answer: [{ data: `"${signed.txtPayload}"` }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url === `https://arweave.net/${cfgTx}`) {
        return new Response(
          JSON.stringify({
            ...signed.config,
            hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url === 'https://hyperbeam.darkmesh.fun/health') {
        return new Response('ok', { status: 200 })
      }
      return new Response('not_found', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const env = {
      ...baseEnv,
      REFRESH_DOMAINS: 'alpha.example',
      REFRESH_BATCH_LIMIT: '1'
    }
    const pending: Promise<unknown>[] = []

    await worker.scheduled(
      {
        cron: '*/5 * * * *',
        scheduledTime: Date.now()
      },
      env,
      {
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise)
        }
      }
    )

    await Promise.all(pending)
    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith('https://dns.google/resolve'))).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === `https://arweave.net/${cfgTx}`)).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === 'https://hyperbeam.darkmesh.fun/health')).toBe(
      true
    )
  })

  it('persists valid domain map entry after successful refresh + route assertion verify', async () => {
    const cfgTx = 'd'.repeat(43)
    const signed = await createSignedConfigBundle('example.com', cfgTx)
    const domainMap = createDomainMapKv()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://hyperbeam.darkmesh.fun/health') {
        return new Response('ok', { status: 200 })
      }
      if (url === 'https://secrets.darkmesh.fun/route/assert') {
        return new Response(
          JSON.stringify({
            ok: true,
            assertion: {
              v: 'dm-route-assert/1',
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 60,
              challengeNonce: 'nonce-route-assert',
              challengeExp: Math.floor(Date.now() / 1000) + 90,
              domain: 'example.com',
              cfgTx,
              hbHost: 'hyperbeam.darkmesh.fun'
            },
            signature: 'a'.repeat(128),
            sigAlg: 'ed25519',
            signatureRef: 'worker-ed25519'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url === 'https://secrets.darkmesh.fun/route/assert/verify') {
        return new Response(
          JSON.stringify({ ok: true, verified: true, assertionHash: 'f'.repeat(64) }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('not_found', { status: 404 })
    })
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
          txtPayload: signed.txtPayload,
          configJson: signed.config,
          hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
        })
      },
      {
        ...baseEnv,
        DOMAIN_MAP_KV: domainMap.kv,
        SECRETS_WORKER_BASE_URL: 'https://secrets.darkmesh.fun',
        ROUTE_ASSERT_TOKEN: 'route-assert-token',
        ROUTE_ASSERT_REQUIRE_VERIFY: '1'
      }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.routeAssertion.status).toBe('ok')

    const persistedRaw = domainMap.storage.get('domain:example.com')
    expect(typeof persistedRaw).toBe('string')
    const persisted = parseDomainMapEntry(String(persistedRaw), 'example.com')
    expect(persisted.status).toBe('valid')
    expect(persisted.cfgTx).toBe(cfgTx)
    expect(persisted.writeProcess).toBe(signed.config.writeProcess)
    expect(persisted.resolvedTarget).toContain(signed.config.siteProcess)
  })

  it('stores invalid map state when required route assertion verification fails', async () => {
    const cfgTx = 'e'.repeat(43)
    const signed = await createSignedConfigBundle('example.com', cfgTx)
    const domainMap = createDomainMapKv()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://hyperbeam.darkmesh.fun/health') {
        return new Response('ok', { status: 200 })
      }
      if (url === 'https://secrets.darkmesh.fun/route/assert') {
        return new Response(
          JSON.stringify({
            ok: true,
            assertion: {
              v: 'dm-route-assert/1',
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 60,
              challengeNonce: 'nonce-route-assert',
              challengeExp: Math.floor(Date.now() / 1000) + 90,
              domain: 'example.com',
              cfgTx,
              hbHost: 'hyperbeam.darkmesh.fun'
            },
            signature: 'a'.repeat(128),
            sigAlg: 'ed25519',
            signatureRef: 'worker-ed25519'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url === 'https://secrets.darkmesh.fun/route/assert/verify') {
        return new Response(JSON.stringify({ ok: false, error: 'replay_detected' }), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('not_found', { status: 404 })
    })
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
          txtPayload: signed.txtPayload,
          configJson: signed.config,
          hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
        })
      },
      {
        ...baseEnv,
        DOMAIN_MAP_KV: domainMap.kv,
        SECRETS_WORKER_BASE_URL: 'https://secrets.darkmesh.fun',
        ROUTE_ASSERT_TOKEN: 'route-assert-token',
        ROUTE_ASSERT_REQUIRE_VERIFY: '1'
      }
    )

    expect(res.status).toBe(502)
    const body = (await res.json()) as any
    expect(body.error).toBe('route_assert_verify_failed')

    const persistedRaw = domainMap.storage.get('domain:example.com')
    expect(typeof persistedRaw).toBe('string')
    const persisted = parseDomainMapEntry(String(persistedRaw), 'example.com')
    expect(persisted.status).toBe('invalid')
    expect(persisted.lastErrorCode).toBe('route_assert_verify_failed')
  })
})
