import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getIntegrityRetryDelayMs, resolveIntegrityFetchControl } from '../src/integrity/fetch-control.js'

describe('integrity fetch control profile tuning', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses vps_medium defaults when no profile is configured', () => {
    delete process.env.GATEWAY_RESOURCE_PROFILE
    delete process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS
    delete process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS
    delete process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
      retryJitterMs: 25,
    })
  })

  it('uses vps_small profile defaults for constrained hosts', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'vps_small'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 4000,
      retryAttempts: 2,
      retryBackoffMs: 75,
      retryJitterMs: 25,
    })
  })

  it('normalizes profile aliases with whitespace and case differences', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = '  VPS-Medium  '

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
      retryJitterMs: 25,
    })
  })

  it('supports profile aliases for diskless mode', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'memory-only'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 4000,
      retryAttempts: 2,
      retryBackoffMs: 75,
      retryJitterMs: 25,
    })
  })

  it('falls back to vps_medium when the configured profile is unknown', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'not-a-real-profile'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
      retryJitterMs: 25,
    })
  })

  it('lets AO_INTEGRITY_FETCH_* env vars override profile defaults', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'vps_small'
    process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS = '8000'
    process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS = '4'
    process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS = '250'
    process.env.AO_INTEGRITY_FETCH_RETRY_JITTER_MS = '90'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 8000,
      retryAttempts: 4,
      retryBackoffMs: 250,
      retryJitterMs: 90,
    })
  })

  it('clamps retry jitter to the configured maximum and accepts zero', () => {
    process.env.AO_INTEGRITY_FETCH_RETRY_JITTER_MS = '999'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
      retryJitterMs: 500,
    })

    expect(
      resolveIntegrityFetchControl({
        retryJitterMs: 0,
      }),
    ).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
      retryJitterMs: 0,
    })
  })

  it('lets explicit function overrides win over env/profile defaults', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'vps_small'
    process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS = '8000'
    process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS = '4'
    process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS = '250'

    expect(
      resolveIntegrityFetchControl({
        timeoutMs: 1200,
        retryAttempts: 1,
        retryBackoffMs: 0,
        retryJitterMs: 0,
      }),
    ).toEqual({
      timeoutMs: 1200,
      retryAttempts: 1,
      retryBackoffMs: 0,
      retryJitterMs: 0,
    })
  })

  it('adds deterministic jitter when a random sampler is injected', () => {
    expect(getIntegrityRetryDelayMs(100, 1, 25, () => 0)).toBe(100)
    expect(getIntegrityRetryDelayMs(100, 3, 0, () => 0.75)).toBe(400)
    expect(getIntegrityRetryDelayMs(100, 2, 25, () => 0.999)).toBe(225)
    expect(getIntegrityRetryDelayMs(100, 1, 999, () => 0.5)).toBe(350)
    expect(getIntegrityRetryDelayMs(100, 1, 25, () => -1)).toBe(100)
  })
})
