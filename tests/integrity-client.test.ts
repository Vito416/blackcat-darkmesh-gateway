import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchIntegritySnapshot, IntegritySnapshotError } from '../src/integrity/client.js'
import { reset as resetMetrics, snapshot as metricsSnapshot, toProm, inc } from '../src/metrics.js'

describe('integrity snapshot client', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetMetrics()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
    resetMetrics()
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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

  it('renders mirror metric help text in Prom output', () => {
    inc('gateway_integrity_mirror_mismatch')
    inc('gateway_integrity_mirror_fetch_fail')

    const prom = toProm()
    expect(prom).toContain(
      '# HELP gateway_integrity_mirror_mismatch_total Integrity mirror snapshots that disagree with the primary integrity snapshot',
    )
    expect(prom).toContain(
      '# HELP gateway_integrity_mirror_fetch_fail_total Integrity mirror snapshot fetch or validation failures',
    )
    expect(prom).toContain('# TYPE gateway_integrity_mirror_mismatch_total counter')
    expect(prom).toContain('# TYPE gateway_integrity_mirror_fetch_fail_total counter')
    expect(prom).toMatch(/gateway_integrity_mirror_mismatch_total 1/)
    expect(prom).toMatch(/gateway_integrity_mirror_fetch_fail_total 1/)
  })

  it('keeps the primary snapshot unchanged when mirrors are unset', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(validSnapshot()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const snapshot = await fetchIntegritySnapshot()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(snapshot.release.root).toBe('root-abc')
    expect(metricsSnapshot().counters.gateway_integrity_mirror_mismatch).toBeUndefined()
    expect(metricsSnapshot().counters.gateway_integrity_mirror_fetch_fail).toBeUndefined()
  })

  it('filters invalid mirror URLs before checking consistency', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.AO_INTEGRITY_MIRROR_URLS = 'not-a-url, https://mirror.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_STRICT

    const primary = validSnapshot()
    const mirror = validSnapshot()
    mirror.release.version = '1.2.1'

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === process.env.AO_INTEGRITY_URL) {
        return Promise.resolve(
          new Response(JSON.stringify(primary), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify(mirror), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    const snapshot = await fetchIntegritySnapshot()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(snapshot.release.root).toBe('root-abc')
    expect(metricsSnapshot().counters.gateway_integrity_mirror_mismatch).toBe(1)
    expect(metricsSnapshot().counters.gateway_integrity_mirror_fetch_fail).toBeUndefined()
  })

  it('increments mirror mismatch metrics and returns the primary snapshot in non-strict mode', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.AO_INTEGRITY_MIRROR_URLS = 'https://mirror.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_STRICT

    const primary = validSnapshot()
    const mirror = validSnapshot()
    mirror.release.root = 'root-mirror'
    mirror.policy.activeRoot = 'root-mirror'
    mirror.release.version = '1.2.1'

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === process.env.AO_INTEGRITY_URL) {
        return Promise.resolve(
          new Response(JSON.stringify(primary), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify(mirror), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    const snapshot = await fetchIntegritySnapshot()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(snapshot.release.root).toBe('root-abc')
    expect(snapshot.policy.activeRoot).toBe('root-abc')
    expect(snapshot.release.version).toBe('1.2.0')
    expect(metricsSnapshot().counters.gateway_integrity_mirror_mismatch).toBe(1)
    expect(metricsSnapshot().counters.gateway_integrity_mirror_fetch_fail).toBeUndefined()
  })

  it('fails closed in strict mode when a mirror mismatches', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.AO_INTEGRITY_MIRROR_URLS = 'https://mirror.example/integrity'
    process.env.AO_INTEGRITY_MIRROR_STRICT = '1'

    const primary = validSnapshot()
    const mirror = validSnapshot()
    mirror.release.version = '1.2.1'

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === process.env.AO_INTEGRITY_URL) {
        return Promise.resolve(
          new Response(JSON.stringify(primary), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify(mirror), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })
    expect(metricsSnapshot().counters.gateway_integrity_mirror_mismatch).toBe(1)
    expect(metricsSnapshot().counters.gateway_integrity_mirror_fetch_fail || 0).toBe(0)
  })

  it('fails closed in strict mode when a mirror fetch fails', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.AO_INTEGRITY_MIRROR_URLS = 'https://mirror.example/integrity'
    process.env.AO_INTEGRITY_MIRROR_STRICT = '1'
    process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS = '1'

    const primary = validSnapshot()

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === process.env.AO_INTEGRITY_URL) {
        return Promise.resolve(
          new Response(JSON.stringify(primary), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }

      return Promise.reject(new Error('mirror offline'))
    })

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })
    expect(metricsSnapshot().counters.gateway_integrity_mirror_fetch_fail).toBe(1)
    expect(metricsSnapshot().counters.gateway_integrity_mirror_mismatch || 0).toBe(0)
  })

  it('accepts release-root parity when active and compatibility roots align', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    const broken = validSnapshot()
    broken.policy.activeRoot = 'root-def'

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('fails closed when an active snapshot is marked revoked', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    const broken = validSnapshot()
    broken.release.revokedAt = '2026-04-09T01:00:00Z'

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('fails closed when compatibility state points at an unrelated root', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    const broken = validSnapshot()
    broken.policy.compatibilityState = {
      root: 'root-other',
      hash: 'compat-123',
      until: '2026-04-09T01:00:00Z',
    }

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('fails closed when policy.paused is not a boolean', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    const broken = validSnapshot()
    broken.policy.paused = 'false' as unknown as boolean

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('fails closed when audit.seqFrom is not a finite number', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    const broken = validSnapshot()
    broken.audit.seqFrom = '1' as unknown as number

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('times out slow fetches using the configured timeout', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }))

    await expect(fetchIntegritySnapshot()).rejects.toMatchObject({
      code: 'integrity_fetch_failed',
    })
  })

  it('wraps fetch failures deterministically', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    delete process.env.AO_INTEGRITY_MIRROR_URLS
    delete process.env.AO_INTEGRITY_MIRROR_STRICT
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
