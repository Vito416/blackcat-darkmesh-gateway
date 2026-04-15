import { describe, expect, it } from 'vitest'
import {
  buildComparisonReport,
  parseGatewayUrls,
  resolveTokensForUrls,
} from '../scripts/lib/compare-integrity-state-core.js'

describe('compare-integrity-state core', () => {
  it('parses and normalizes gateway urls', () => {
    const urls = parseGatewayUrls(['https://gw-a.example/integrity', 'http://gw-b.example'])

    expect(urls).toEqual(['https://gw-a.example/integrity', 'http://gw-b.example/'])
  })

  it('rejects invalid or unsupported urls', () => {
    expect(() => parseGatewayUrls(['notaurl', 'https://gw-b.example'])).toThrow('invalid url: notaurl')
    expect(() => parseGatewayUrls(['ftp://gw-a.example', 'https://gw-b.example'])).toThrow(
      'unsupported url protocol: ftp://gw-a.example',
    )
    expect(() => parseGatewayUrls(['https://gw-a.example'])).toThrow(
      'at least two --url values are required',
    )
  })

  it('resolves shared, per-url, and env fallback tokens', () => {
    const urls = ['https://gw-a.example', 'https://gw-b.example']

    expect(resolveTokensForUrls(urls, ['shared-token'], '')).toEqual(['shared-token', 'shared-token'])
    expect(resolveTokensForUrls(urls, ['token-a', 'token-b'], '')).toEqual(['token-a', 'token-b'])
    expect(resolveTokensForUrls(urls, [], ' env-token ')).toEqual([' env-token ', ' env-token '])
    expect(resolveTokensForUrls(urls, [], '', { allowAnonymous: true })).toEqual(['', ''])
  })

  it('rejects blank or mismatched token mapping', () => {
    const urls = ['https://gw-a.example', 'https://gw-b.example']

    expect(() => resolveTokensForUrls(urls, ['   '], '')).toThrow('--token values must not be blank')
    expect(() => resolveTokensForUrls(urls, ['token-a', 'token-b', 'token-c'], '')).toThrow(
      'pass either one --token for all URLs or one --token per URL',
    )
    expect(() => resolveTokensForUrls(urls, [], '   ')).toThrow(
      'missing token: set GATEWAY_INTEGRITY_STATE_TOKEN or pass --token',
    )
  })

  it('builds a mismatch summary with consensus and invalid rows', () => {
    const report = buildComparisonReport([
      {
        label: '#1 gw-a',
        snapshot: {
          policy: { paused: false, activeRoot: 'root-a', activePolicyHash: 'hash-a' },
          release: { version: '1.2.0', root: 'root-a' },
          audit: { seqTo: 9 },
        },
      },
      {
        label: '#2 gw-b',
        snapshot: {
          policy: { paused: false, activeRoot: 'root-b', activePolicyHash: 'hash-a' },
          release: { version: '1.2.1', root: 'root-b' },
          audit: { seqTo: 9 },
        },
      },
    ])

    expect(report.invalid).toBe(false)
    expect(report.mismatches).toBe(3)
    expect(report.totalFields).toBe(6)
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'policy.paused',
          status: 'CONSENSUS',
          details: '#1 gw-a=false | #2 gw-b=false',
        }),
        expect.objectContaining({
          field: 'policy.activeRoot',
          status: 'MISMATCH',
          details: '#1 gw-a="root-a" | #2 gw-b="root-b"',
        }),
        expect.objectContaining({
          field: 'release.version',
          status: 'MISMATCH',
          details: '#1 gw-a="1.2.0" | #2 gw-b="1.2.1"',
        }),
      ]),
    )
  })

  it('marks the report invalid when a field is missing from any snapshot', () => {
    const report = buildComparisonReport([
      { label: '#1 gw-a', snapshot: { policy: { paused: false }, release: { version: '1.2.0' }, audit: { seqTo: 1 } } },
      { label: '#2 gw-b', snapshot: { policy: { paused: false }, release: { version: '1.2.0' }, audit: {} } },
    ])

    const row = report.rows.find((entry) => entry.field === 'audit.seqTo')
    expect(report.invalid).toBe(true)
    expect(report.mismatches).toBe(0)
    expect(row).toMatchObject({
      field: 'audit.seqTo',
      status: 'INVALID',
      details: 'missing field in one or more snapshots',
    })
  })
})
