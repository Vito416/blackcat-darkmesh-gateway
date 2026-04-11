import { describe, expect, it } from 'vitest'
import { validateAnalyticsEvent } from '../src/runtime/telemetry/analyticsPolicy.js'

describe('runtime telemetry analytics policy helpers', () => {
  it('normalizes and accepts valid analytics payloads', () => {
    const fixedNow = Date.parse('2026-01-01T00:00:00.000Z')
    const result = validateAnalyticsEvent(
      {
        event: 'gateway.request.accepted',
        timestamp: 'not-a-real-date',
        tags: {
          region: 'eu-central-1',
          status: 200,
        },
        metadata: {
          route: '/healthz',
          context: { source: 'gateway' },
        },
      },
      {
        now: fixedNow,
        maxEventBytes: 2048,
        maxTags: 8,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.name).toBe('gateway.request.accepted')
    expect(result.value.timestamp).toBe('2026-01-01T00:00:00.000Z')
    expect(result.value.tags).toEqual({
      region: 'eu-central-1',
      status: 200,
    })
    expect(result.value.metadata.route).toBe('/healthz')
    expect(typeof result.value.metadata.context).toBe('string')
  })

  it('rejects payloads with denylisted sensitive keys', () => {
    const result = validateAnalyticsEvent({
      event: 'gateway.request.accepted',
      tags: {
        authorization: 'Bearer top-secret',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('sensitive key')
  })

  it('rejects payloads that exceed max event size bytes', () => {
    const result = validateAnalyticsEvent(
      {
        event: 'gateway.request.accepted',
        metadata: {
          details: 'x'.repeat(512),
        },
      },
      {
        maxEventBytes: 120,
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('max event size')
  })

  it('rejects invalid event names', () => {
    const result = validateAnalyticsEvent({
      event: 'Gateway Request Accepted',
      tags: {
        region: 'eu-central-1',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('event name')
  })
})
