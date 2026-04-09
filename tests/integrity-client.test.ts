import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchIntegritySnapshot, IntegritySnapshotError } from '../src/integrity/client.js'

describe('integrity snapshot client', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  function validSnapshot() {
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
        paused: false,
        maxCheckInAgeSec: 3600,
      },
      authority: {
        root: 'sig-root',
        upgrade: 'sig-upgrade',
        emergency: 'sig-emergency',
        reporter: 'sig-reporter',
        signatureRefs: ['sig-root', 'sig-upgrade'],
      },
      audit: {
        seqFrom: 1,
        seqTo: 3,
        merkleRoot: 'merkle-xyz',
        metaHash: 'audit-meta',
        reporterRef: 'sig-reporter',
        acceptedAt: '2026-04-09T00:00:00Z',
      },
    }
  }

  it('returns a validated snapshot', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(validSnapshot()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const snapshot = await fetchIntegritySnapshot()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(snapshot.policy.activeRoot).toBe('root-abc')
    expect(snapshot.release.componentId).toBe('gateway')
    expect(snapshot.authority.signatureRefs).toEqual(['sig-root', 'sig-upgrade'])
  })

  it('fails closed when active root is missing', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const broken = validSnapshot()
    broken.policy.activeRoot = ''

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'missing_trusted_root',
    })
  })

  it('rejects malformed JSON payloads', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
  })

  it('rejects non-object payloads', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(['nope']), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
  })

  it('fails on non-2xx upstream responses', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }))

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })
  })

  it('wraps fetch failures deterministically', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    try {
      await fetchIntegritySnapshot()
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(IntegritySnapshotError)
      expect((error as IntegritySnapshotError).code).toBe('integrity_fetch_failed')
    }
  })
})

