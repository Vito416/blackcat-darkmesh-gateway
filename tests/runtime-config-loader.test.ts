import { describe, expect, it } from 'vitest'
import {
  loadBooleanConfig,
  loadConfigValue,
  loadIntegerConfig,
  loadStringConfig,
  parseEnvBoolean,
  parseEnvInteger,
} from '../src/runtime/config/loader.js'

describe('runtime config loader', () => {
  it('loads env strings with non-secret source metadata', () => {
    const result = loadStringConfig('GATEWAY_TEMPLATE_BASE_URL', {
      env: { GATEWAY_TEMPLATE_BASE_URL: 'https://example.test' },
    })

    expect(result).toEqual({
      ok: true,
      name: 'GATEWAY_TEMPLATE_BASE_URL',
      value: 'https://example.test',
      source: {
        kind: 'env',
        name: 'GATEWAY_TEMPLATE_BASE_URL',
        redacted: false,
        value: 'https://example.test',
      },
    })
  })

  it('redacts secret source metadata while preserving the resolved value', () => {
    const result = loadStringConfig('WORKER_AUTH_TOKEN', {
      env: { WORKER_AUTH_TOKEN: '  super-secret-token  ' },
      secret: true,
    })

    expect(result).toEqual({
      ok: true,
      name: 'WORKER_AUTH_TOKEN',
      value: 'super-secret-token',
      source: {
        kind: 'env',
        name: 'WORKER_AUTH_TOKEN',
        redacted: true,
        value: '[redacted]',
      },
    })
  })

  it('prefers fallback metadata before default metadata when the env var is missing', () => {
    const result = loadIntegerConfig('GATEWAY_INTEGRITY_TIMEOUT_MS', {
      env: {},
      fallbackValue: 4000,
      defaultValue: 5000,
    })

    expect(result).toEqual({
      ok: true,
      name: 'GATEWAY_INTEGRITY_TIMEOUT_MS',
      value: 4000,
      source: {
        kind: 'fallback',
        name: 'GATEWAY_INTEGRITY_TIMEOUT_MS',
        redacted: false,
        value: '4000',
      },
    })
  })

  it('returns a deterministic missing result for required env vars', () => {
    const first = loadBooleanConfig('GATEWAY_ENABLE_TRACE', { env: {}, required: true })
    const second = loadBooleanConfig('GATEWAY_ENABLE_TRACE', { env: {}, required: true })

    expect(first).toEqual({
      ok: false,
      name: 'GATEWAY_ENABLE_TRACE',
      code: 'missing_required_env',
      message: 'Missing required env var GATEWAY_ENABLE_TRACE',
      source: {
        kind: 'missing',
        name: 'GATEWAY_ENABLE_TRACE',
        redacted: false,
      },
    })
    expect(second).toEqual(first)
  })

  it('returns a deterministic invalid result for required typed env vars', () => {
    const result = loadIntegerConfig('GATEWAY_RL_MAX', {
      env: { GATEWAY_RL_MAX: 'abc' },
      required: true,
    })

    expect(result).toEqual({
      ok: false,
      name: 'GATEWAY_RL_MAX',
      code: 'invalid_required_env',
      message: 'Invalid env var value for GATEWAY_RL_MAX',
      source: {
        kind: 'env',
        name: 'GATEWAY_RL_MAX',
        redacted: false,
        value: 'abc',
      },
    })
  })

  it('keeps invalid optional env values deterministic instead of silently coercing them', () => {
    const result = loadBooleanConfig('GATEWAY_CACHE_EVICT_LRU', {
      env: { GATEWAY_CACHE_EVICT_LRU: 'maybe' },
    })

    expect(result).toEqual({
      ok: false,
      name: 'GATEWAY_CACHE_EVICT_LRU',
      code: 'invalid_optional_env',
      message: 'Invalid env var value for GATEWAY_CACHE_EVICT_LRU',
      source: {
        kind: 'env',
        name: 'GATEWAY_CACHE_EVICT_LRU',
        redacted: false,
        value: 'maybe',
      },
    })
  })

  it('exposes parser helpers for reuse across runtime paths', () => {
    expect(parseEnvInteger('42')).toBe(42)
    expect(parseEnvInteger('4.2')).toBeNull()
    expect(parseEnvBoolean('yes')).toBe(true)
    expect(parseEnvBoolean('OFF')).toBe(false)
    expect(parseEnvBoolean('perhaps')).toBeNull()
  })

  it('supports optional missing values without failing', () => {
    const result = loadConfigValue('GATEWAY_HMAC_SECRET', (raw) => raw, { env: {} })

    expect(result).toEqual({
      ok: true,
      name: 'GATEWAY_HMAC_SECRET',
      value: undefined,
      source: {
        kind: 'missing',
        name: 'GATEWAY_HMAC_SECRET',
        redacted: false,
      },
    })
  })
})

