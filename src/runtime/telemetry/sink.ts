import type { NormalizedAnalyticsEvent } from './analyticsEvent.js'

export interface AnalyticsSinkPolicyOptions {
  retainForMs?: number
  now?: number | (() => number)
}

export interface AnalyticsSinkHandlers {
  emit?: (event: NormalizedAnalyticsEvent) => unknown | Promise<unknown>
  store?: (event: NormalizedAnalyticsEvent) => unknown | Promise<unknown>
}

export type AnalyticsSinkDecision =
  | {
      ok: true
      action: 'accept'
      reason: 'within-retention'
      event: NormalizedAnalyticsEvent
      ageMs: number
      retainedForMs: number | null
    }
  | {
      ok: false
      action: 'drop'
      reason: 'expired' | 'invalid-timestamp'
      event: NormalizedAnalyticsEvent
      ageMs?: number
      retainedForMs: number | null
    }

export type AnalyticsSinkResult = AnalyticsSinkDecision & {
  emitted: boolean
  stored: boolean
}

export interface AnalyticsSinkOptions extends AnalyticsSinkPolicyOptions, AnalyticsSinkHandlers {}

function resolveNow(now: number | (() => number) | undefined): number {
  if (typeof now === 'function') {
    const computed = now()
    if (typeof computed === 'number' && Number.isFinite(computed)) return computed
  }

  if (typeof now === 'number' && Number.isFinite(now)) return now

  return Date.now()
}

function normalizeRetentionWindow(retainForMs: number | undefined): number | null {
  if (retainForMs === undefined) return null
  if (!Number.isFinite(retainForMs)) return 0
  if (retainForMs < 0) return 0
  return Math.floor(retainForMs)
}

function resolveEventAgeMs(event: NormalizedAnalyticsEvent, now: number): number | null {
  const eventMillis = Date.parse(event.timestamp)
  if (!Number.isFinite(eventMillis)) return null
  return now - eventMillis
}

export function evaluateAnalyticsSink(
  event: NormalizedAnalyticsEvent,
  options: AnalyticsSinkPolicyOptions = {},
): AnalyticsSinkDecision {
  const retainedForMs = normalizeRetentionWindow(options.retainForMs)
  const now = resolveNow(options.now)
  const ageMs = resolveEventAgeMs(event, now)

  if (ageMs === null) {
    return {
      ok: false,
      action: 'drop',
      reason: 'invalid-timestamp',
      event,
      retainedForMs,
    }
  }

  if (retainedForMs !== null && ageMs > retainedForMs) {
    return {
      ok: false,
      action: 'drop',
      reason: 'expired',
      event,
      ageMs,
      retainedForMs,
    }
  }

  return {
    ok: true,
    action: 'accept',
    reason: 'within-retention',
    event,
    ageMs,
    retainedForMs,
  }
}

export async function sinkAnalyticsEvent(
  event: NormalizedAnalyticsEvent,
  options: AnalyticsSinkOptions = {},
): Promise<AnalyticsSinkResult> {
  const decision = evaluateAnalyticsSink(event, options)
  if (!decision.ok) {
    return {
      ...decision,
      emitted: false,
      stored: false,
    }
  }

  if (options.emit) {
    await options.emit(event)
  }

  if (options.store) {
    await options.store(event)
  }

  return {
    ...decision,
    emitted: !!options.emit,
    stored: !!options.store,
  }
}
