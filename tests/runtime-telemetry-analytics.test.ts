import { describe, expect, it, vi } from 'vitest'
import { validateAnalyticsEvent } from '../src/runtime/telemetry/analyticsPolicy.js'
import { evaluateAnalyticsSink, sinkAnalyticsEvent } from '../src/runtime/telemetry/sink.js'

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

  it('accepts analytics events that are still within the retention window', async () => {
    const fixedNow = Date.parse('2026-01-01T00:10:00.000Z')
    const validated = validateAnalyticsEvent(
      {
        event: 'gateway.request.accepted',
        timestamp: '2026-01-01T00:00:00.000Z',
        tags: {
          region: 'eu-central-1',
        },
      },
      {
        now: fixedNow,
      },
    )

    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const emit = vi.fn()
    const store = vi.fn()
    const decision = evaluateAnalyticsSink(validated.value, {
      retainForMs: 15 * 60 * 1000,
      now: fixedNow,
    })

    expect(decision).toEqual({
      ok: true,
      action: 'accept',
      reason: 'within-retention',
      event: validated.value,
      ageMs: 10 * 60 * 1000,
      retainedForMs: 15 * 60 * 1000,
    })

    const result = await sinkAnalyticsEvent(validated.value, {
      retainForMs: 15 * 60 * 1000,
      now: fixedNow,
      emit,
      store,
    })

    expect(result).toEqual({
      ...decision,
      emitted: true,
      stored: true,
    })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(validated.value)
    expect(store).toHaveBeenCalledTimes(1)
    expect(store).toHaveBeenCalledWith(validated.value)
  })

  it('drops analytics events that have expired past the retention window', async () => {
    const fixedNow = Date.parse('2026-01-01T00:10:00.000Z')
    const validated = validateAnalyticsEvent(
      {
        event: 'gateway.request.dropped',
        timestamp: '2026-01-01T00:00:00.000Z',
        tags: {
          region: 'eu-central-1',
        },
      },
      {
        now: fixedNow,
      },
    )

    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const emit = vi.fn()
    const store = vi.fn()
    const decision = evaluateAnalyticsSink(validated.value, {
      retainForMs: 5 * 60 * 1000,
      now: fixedNow,
    })

    expect(decision).toEqual({
      ok: false,
      action: 'drop',
      reason: 'expired',
      event: validated.value,
      ageMs: 10 * 60 * 1000,
      retainedForMs: 5 * 60 * 1000,
    })

    const result = await sinkAnalyticsEvent(validated.value, {
      retainForMs: 5 * 60 * 1000,
      now: fixedNow,
      emit,
      store,
    })

    expect(result).toEqual({
      ...decision,
      emitted: false,
      stored: false,
    })
    expect(emit).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
  })
})
