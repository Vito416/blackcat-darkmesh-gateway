import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveIntegrityFetchControl } from '../src/integrity/fetch-control.js'

describe('integrity fetch control profile tuning', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses wedos_medium defaults when no profile is configured', () => {
    delete process.env.GATEWAY_RESOURCE_PROFILE
    delete process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS
    delete process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS
    delete process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
    })
  })

  it('uses wedos_small profile defaults for constrained hosts', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'wedos_small'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 4000,
      retryAttempts: 2,
      retryBackoffMs: 75,
    })
  })

  it('normalizes profile aliases with whitespace and case differences', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = '  WeDoS-Medium  '

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
    })
  })

  it('supports profile aliases for diskless mode', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'memory-only'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 4000,
      retryAttempts: 2,
      retryBackoffMs: 75,
    })
  })

  it('falls back to wedos_medium when the configured profile is unknown', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'not-a-real-profile'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 5000,
      retryAttempts: 3,
      retryBackoffMs: 100,
    })
  })

  it('lets AO_INTEGRITY_FETCH_* env vars override profile defaults', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'wedos_small'
    process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS = '8000'
    process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS = '4'
    process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS = '250'

    expect(resolveIntegrityFetchControl()).toEqual({
      timeoutMs: 8000,
      retryAttempts: 4,
      retryBackoffMs: 250,
    })
  })

  it('lets explicit function overrides win over env/profile defaults', () => {
    process.env.GATEWAY_RESOURCE_PROFILE = 'wedos_small'
    process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS = '8000'
    process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS = '4'
    process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS = '250'

    expect(
      resolveIntegrityFetchControl({
        timeoutMs: 1200,
        retryAttempts: 1,
        retryBackoffMs: 0,
      }),
    ).toEqual({
      timeoutMs: 1200,
      retryAttempts: 1,
      retryBackoffMs: 0,
    })
  })
})
