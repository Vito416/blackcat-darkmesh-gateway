import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchIntegritySnapshot, IntegritySnapshotError } from '../src/integrity/client.js'

describe('integrity snapshot client', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('accepts release-root parity when active and compatibility roots align', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const snapshotData = validSnapshot()
    snapshotData.policy.compatibilityState = {
      root: 'root-abc',
      hash: 'compat-123',
      until: '2026-04-09T01:00:00Z',
    }
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(snapshotData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const snapshot = await fetchIntegritySnapshot()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(snapshot.policy.compatibilityState?.root).toBe('root-abc')
    expect(snapshot.release.root).toBe(snapshot.policy.activeRoot)
  })

  it('fails closed when active root diverges from the release root', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const broken = validSnapshot()
    broken.policy.activeRoot = 'root-def'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
  })

  it('fails closed when an active snapshot is marked revoked', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const broken = validSnapshot()
    broken.release.revokedAt = '2026-04-09T01:00:00Z'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
  })

  it('fails closed when compatibility state points at an unrelated root', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const broken = validSnapshot()
    broken.policy.compatibilityState = {
      root: 'root-other',
      hash: 'compat-123',
      until: '2026-04-09T01:00:00Z',
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
  })

  it('fails closed when policy.paused is not a boolean', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const broken = validSnapshot()
    broken.policy.paused = 'false' as unknown as boolean

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
  })

  it('fails closed when audit.seqFrom is not a finite number', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const broken = validSnapshot()
    broken.audit.seqFrom = '1' as unknown as number

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
  })

  it('times out slow fetches using the configured timeout', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS = '20'
    vi.useFakeTimers()

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true },
        )
      })
    })

    const pending = fetchIntegritySnapshot({
      retryAttempts: 1,
    })
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })

    await vi.advanceTimersByTimeAsync(20)

    await rejected
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('retries once after a transient fetch failure and then succeeds', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validSnapshot()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    const snapshot = await fetchIntegritySnapshot({
      timeoutMs: 1000,
      retryAttempts: 2,
      retryBackoffMs: 0,
    })

    expect(spy).toHaveBeenCalledTimes(2)
    expect(snapshot.release.componentId).toBe('gateway')
    expect(snapshot.policy.activeRoot).toBe('root-abc')
  })

  it('stops retrying after transient failures are exhausted', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      fetchIntegritySnapshot({
        timeoutMs: 1000,
        retryAttempts: 3,
        retryBackoffMs: 0,
      }),
    ).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })

    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('accepts AO codec envelope responses and unwraps payload', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          payload: validSnapshot(),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const snapshot = await fetchIntegritySnapshot()
    expect(snapshot.release.root).toBe('root-abc')
    expect(snapshot.policy.activePolicyHash).toBe('policy-789')
  })

  it('accepts AO codec envelope responses with body field', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          body: validSnapshot(),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const snapshot = await fetchIntegritySnapshot()
    expect(snapshot.release.version).toBe('1.2.0')
    expect(snapshot.authority.reporter).toBe('sig-reporter')
  })

  it('accepts AO codec envelope responses with result field', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          result: validSnapshot(),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const snapshot = await fetchIntegritySnapshot()
    expect(snapshot.release.root).toBe('root-abc')
    expect(snapshot.audit.seqTo).toBe(3)
  })

  it('fails on AO codec error envelopes', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ERROR',
          code: 'NOT_FOUND',
          message: 'Active trusted release is not set',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })
  })

  it('fails closed when codec envelope reports OK but omits a payload field', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
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
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
    expect(spy).toHaveBeenCalledTimes(1)
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
