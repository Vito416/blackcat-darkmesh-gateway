import { describe, expect, it } from 'vitest'
import {
  DOMAIN_MAP_SCHEMA_VERSION,
  InMemoryDomainMapKvAdapter,
  createEmptyDomainMapEntry,
  getDomainMapEntry,
  listDomainMapEntries,
  parseDomainMapEntry,
  putDomainMapEntry,
  upsertDomainStatusMetadata
} from '../src/domainMapStore.js'

const HOST = 'Example.COM'

describe('domain map store', () => {
  it('atomically upserts status metadata including audit fields', async () => {
    const kv = new InMemoryDomainMapKvAdapter()
    const seed = createEmptyDomainMapEntry(HOST, 1_000)
    await putDomainMapEntry(kv, { ...seed, status: 'valid', verifiedAt: 1_000, lastSuccessAt: 1_000 })

    const next = await upsertDomainStatusMetadata(kv, HOST, {
      status: 'stale',
      verifiedAt: 1_500,
      expiresAt: 2_000,
      hbVerifiedAt: 1_900,
      hardExpiresAt: 7_000,
      refreshAttempts: 3,
      lastError: { code: 'probe_error', message: 'hb_404', at: 1_900 },
      nowMs: 2_100
    })

    expect(next.status).toBe('stale')
    expect(next.verifiedAt).toBe(1_500)
    expect(next.expiresAt).toBe(2_000)
    expect(next.hbVerifiedAt).toBe(1_900)
    expect(next.lastError?.code).toBe('probe_error')
    expect(next.lastErrorAt).toBe(1_900)
    expect(next.lastErrorCode).toBe('probe_error')
    expect(next.refreshAttempts).toBe(3)
    expect(next.schemaVersion).toBe(DOMAIN_MAP_SCHEMA_VERSION)
    expect(next.updatedAt).toBe(2_100)
  })

  it('lists and reads persisted entries', async () => {
    const kv = new InMemoryDomainMapKvAdapter()
    await putDomainMapEntry(kv, {
      ...createEmptyDomainMapEntry('alpha.example.com', 1_000),
      status: 'valid',
      verifiedAt: 1_000
    })
    await putDomainMapEntry(kv, {
      ...createEmptyDomainMapEntry('beta.example.com', 1_000),
      status: 'stale',
      verifiedAt: 1_000
    })

    const listed = await listDomainMapEntries(kv)
    const fetched = await getDomainMapEntry(kv, 'alpha.example.com')

    expect(listed).toHaveLength(2)
    expect(fetched?.status).toBe('valid')
    expect(fetched?.schemaVersion).toBe(DOMAIN_MAP_SCHEMA_VERSION)
  })

  it('loads legacy v0 records via migration defaults', () => {
    const rawV0 = JSON.stringify({
      host: 'legacy.example.com',
      status: 'valid',
      cfgTx: 'tx_old',
      resolvedTarget: '~process@1.0/http',
      verifiedAt: 120,
      updatedAt: 123
    })

    const parsed = parseDomainMapEntry(rawV0)
    expect(parsed.host).toBe('legacy.example.com')
    expect(parsed.schemaVersion).toBe(DOMAIN_MAP_SCHEMA_VERSION)
    expect(parsed.lastSuccessAt).toBe(120)
    expect(parsed.lastErrorAt).toBeNull()
    expect(parsed.lastErrorCode).toBeNull()
    expect(parsed.refreshAttempts).toBe(0)
  })

  it('loads legacy v1 records via migration defaults', () => {
    const rawV1 = JSON.stringify({
      schemaVersion: 1,
      host: 'legacy-v1.example.com',
      status: 'stale',
      cfgTx: 'tx_v1',
      resolvedTarget: '~process@1.0/http',
      lastError: { code: 'legacy_error', message: 'legacy', at: 140 },
      updatedAt: 150
    })

    const parsed = parseDomainMapEntry(rawV1)
    expect(parsed.host).toBe('legacy-v1.example.com')
    expect(parsed.schemaVersion).toBe(DOMAIN_MAP_SCHEMA_VERSION)
    expect(parsed.status).toBe('stale')
    expect(parsed.lastErrorCode).toBe('legacy_error')
    expect(parsed.lastErrorAt).toBe(140)
    expect(parsed.refreshAttempts).toBe(0)
  })

  it('falls back deterministically for unknown future schema version', () => {
    const rawFuture = JSON.stringify({
      schemaVersion: DOMAIN_MAP_SCHEMA_VERSION + 10,
      host: 'future.example.com',
      status: 'valid'
    })

    const parsed = parseDomainMapEntry(rawFuture)
    expect(parsed.host).toBe('future.example.com')
    expect(parsed.status).toBe('invalid')
    expect(parsed.schemaVersion).toBe(DOMAIN_MAP_SCHEMA_VERSION)
    expect(parsed.lastErrorCode).toBe('unsupported_schema_version')
    expect(parsed.lastError).not.toBeNull()
  })

  it('handles corrupted persisted records without throwing', () => {
    const parsedJsonError = parseDomainMapEntry('{bad-json', 'corrupt.example.com')
    const parsedShapeError = parseDomainMapEntry('["not-object"]', 'shape.example.com')

    expect(parsedJsonError.host).toBe('corrupt.example.com')
    expect(parsedJsonError.status).toBe('invalid')
    expect(parsedJsonError.lastErrorCode).toBe('corrupt_json')

    expect(parsedShapeError.host).toBe('shape.example.com')
    expect(parsedShapeError.status).toBe('invalid')
    expect(parsedShapeError.lastErrorCode).toBe('invalid_shape')
  })
})
