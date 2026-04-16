import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reset, snapshot } from '../src/metrics.js'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function makeIntegritySnapshot(paused = false) {
  return {
    release: {
      componentId: 'gateway',
      version: '1.2.0',
      root: 'root-abc',
      uriHash: 'uri-123',
      metaHash: 'meta-456',
      publishedAt: '2026-04-09T00:00:00Z',
    },
    policy: {
      activeRoot: 'root-abc',
      activePolicyHash: 'policy-789',
      paused,
      maxCheckInAgeSec: 3600,
    },
    authority: {
      root: 'sig-root',
      upgrade: 'sig-upgrade',
      emergency: 'sig-emergency',
      reporter: 'sig-reporter',
      signatureRefs: ['sig-root'],
    },
    audit: {
      seqFrom: 1,
      seqTo: 1,
      merkleRoot: 'merkle-xyz',
      metaHash: 'audit-meta',
      reporterRef: 'sig-reporter',
      acceptedAt: '2026-04-09T00:00:00Z',
    },
  }
}

describe('integrity cache enforcement', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    reset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    reset()
  })

  async function loadHandler() {
    return import('../src/handler.js')
  }

  it('blocks cache PUT when verified mode is enabled and trusted root is missing', async () => {
    process.env.GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE = '1'
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeIntegritySnapshot(false)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      new Request('http://gateway/cache/template-index', {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'template-v1',
      }),
    )

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'missing_trusted_root' })
    expect(snapshot().counters.gateway_integrity_verify_fail).toBeGreaterThanOrEqual(1)
  })

  it('accepts verified cache PUT and serves it on GET', async () => {
    process.env.GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE = '1'
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.GATEWAY_INTEGRITY_CACHE_TTL_MS = '60000'
    const body = 'template-v1'
    const hash = sha256Hex(body)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === process.env.AO_INTEGRITY_URL) {
        return new Response(JSON.stringify(makeIntegritySnapshot(false)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('unexpected', { status: 500 })
    })

    const { handleRequest } = await loadHandler()

    const put = await handleRequest(
      new Request('http://gateway/cache/template-index', {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-integrity-root': 'root-abc',
          'x-integrity-hash': hash,
        },
        body,
      }),
    )
    expect(put.status).toBe(201)

    const get = await handleRequest(new Request('http://gateway/cache/template-index'))
    expect(get.status).toBe(200)
    await expect(get.text()).resolves.toBe(body)

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_verify_ok).toBeGreaterThanOrEqual(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('accepts verified cache PUT with prefixed, case-variant root headers', async () => {
    process.env.GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE = '1'
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const body = 'template-v1'
    const hash = sha256Hex(body)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeIntegritySnapshot(false)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      new Request('http://gateway/cache/template-index', {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-integrity-root': '  SHA256:0xROOT-ABC  ',
          'x-integrity-hash': hash,
        },
        body,
      }),
    )

    expect(res.status).toBe(201)
    expect(snapshot().counters.gateway_integrity_verify_ok).toBeGreaterThanOrEqual(1)
  })

  it('blocks cache PUT on hash mismatch', async () => {
    process.env.GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE = '1'
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeIntegritySnapshot(false)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      new Request('http://gateway/cache/template-index', {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-integrity-root': 'root-abc',
          'x-integrity-hash': 'deadbeef',
        },
        body: 'template-v1',
      }),
    )

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'integrity_mismatch' })
    expect(snapshot().counters.gateway_integrity_verify_fail).toBeGreaterThanOrEqual(1)
  })

  it('fails closed when AO integrity snapshot is unavailable and no checkpoint exists', async () => {
    process.env.GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE = '1'
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }))

    const { handleRequest } = await loadHandler()
    const body = 'template-v1'
    const hash = sha256Hex(body)
    const res = await handleRequest(
      new Request('http://gateway/cache/template-index', {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-integrity-root': 'root-abc',
          'x-integrity-hash': hash,
        },
        body,
      }),
    )

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'missing_trusted_root' })
    expect(snapshot().counters.gateway_integrity_snapshot_fetch_fail).toBeGreaterThanOrEqual(1)
  })
})
