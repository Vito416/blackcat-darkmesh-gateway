import {
  createEmptyDomainMapEntry,
  type DomainMapEntry,
  type DomainMapError,
  type DomainMapStatus
} from './domainMapStore.js'

export interface DomainStateMachineOptions {
  staleIfErrorMs: number
  minTtlMs?: number
  maxTtlMs?: number
}

export interface DomainRefreshSuccess {
  kind: 'refresh_success'
  cfgTx: string
  resolvedTarget: string
  ttlMs: number
  writeProcess?: string | null
  configHash?: string | null
  hbVerifiedAt?: number | null
}

export interface DomainRefreshFailure {
  kind: 'refresh_failure'
  error: string | DomainMapError
}

export interface DomainProbeSuccess {
  kind: 'probe_success'
}

export interface DomainProbeFailure {
  kind: 'probe_failure'
  error: string | DomainMapError
}

export type DomainRefreshOutcome = DomainRefreshSuccess | DomainRefreshFailure
export type DomainProbeOutcome = DomainProbeSuccess | DomainProbeFailure
export type RefreshScheduleReason =
  | 'initial'
  | 'valid_refresh'
  | 'stale_retry'
  | 'invalid_retry'
  | 'hard_expired'

export interface DomainRefreshSchedulingOptions {
  validLeadMs?: number
  staleRetryMs?: number
  invalidRetryMs?: number
  jitterRatio?: number
}

export interface DomainRefreshSchedulingHint {
  reason: RefreshScheduleReason
  baseRefreshAt: number
  nextRefreshAt: number
  jitterOffsetMs: number
  isDue: boolean
}

const DEFAULT_OPTIONS: DomainStateMachineOptions = {
  staleIfErrorMs: 5 * 60 * 1000,
  minTtlMs: 30_000,
  maxTtlMs: 24 * 60 * 60 * 1000
}
const DEFAULT_SCHEDULING: Required<DomainRefreshSchedulingOptions> = {
  validLeadMs: 30_000,
  staleRetryMs: 15_000,
  invalidRetryMs: 30_000,
  jitterRatio: 0.1
}

function clampTtl(ttlMs: number, options: DomainStateMachineOptions): number {
  const minTtlMs = options.minTtlMs ?? DEFAULT_OPTIONS.minTtlMs!
  const maxTtlMs = options.maxTtlMs ?? DEFAULT_OPTIONS.maxTtlMs!
  return Math.max(minTtlMs, Math.min(ttlMs, maxTtlMs))
}

function asError(error: string | DomainMapError, at: number): DomainMapError {
  if (typeof error === 'string') {
    return { code: 'error', message: error, at }
  }
  return {
    code: error.code || 'error',
    message: error.message || 'unknown_error',
    at: error.at ?? at
  }
}

function shouldInvalidate(entry: DomainMapEntry, nowMs: number): boolean {
  return entry.hardExpiresAt !== null && nowMs > entry.hardExpiresAt
}

function hasServeableTarget(entry: DomainMapEntry): boolean {
  return Boolean(entry.cfgTx && entry.resolvedTarget)
}

function canUseStaleIfError(entry: DomainMapEntry, nowMs: number): boolean {
  return hasServeableTarget(entry) && entry.hardExpiresAt !== null && nowMs <= entry.hardExpiresAt
}

function withStatus(entry: DomainMapEntry, status: DomainMapStatus, nowMs: number): DomainMapEntry {
  return {
    ...entry,
    status,
    updatedAt: nowMs
  }
}

export function applyHardExpiry(entry: DomainMapEntry, nowMs: number): DomainMapEntry {
  if (!shouldInvalidate(entry, nowMs)) {
    return entry
  }
  return {
    ...entry,
    status: 'invalid',
    lastErrorCode: entry.lastErrorCode ?? 'hard_expired',
    updatedAt: nowMs
  }
}

export function applyRefreshOutcome(
  current: DomainMapEntry | null,
  outcome: DomainRefreshOutcome,
  host: string,
  nowMs = Date.now(),
  options: Partial<DomainStateMachineOptions> = {}
): DomainMapEntry {
  const mergedOptions: DomainStateMachineOptions = { ...DEFAULT_OPTIONS, ...options }
  const entry = applyHardExpiry(current ?? createEmptyDomainMapEntry(host, nowMs), nowMs)

  if (outcome.kind === 'refresh_success') {
    const ttlMs = clampTtl(outcome.ttlMs, mergedOptions)
    const expiresAt = nowMs + ttlMs
    const hardExpiresAt = expiresAt + mergedOptions.staleIfErrorMs
    return {
      ...entry,
      status: 'valid',
      cfgTx: outcome.cfgTx,
      resolvedTarget: outcome.resolvedTarget,
      writeProcess: outcome.writeProcess ?? entry.writeProcess,
      configHash: outcome.configHash ?? entry.configHash,
      verifiedAt: nowMs,
      expiresAt,
      hbVerifiedAt: outcome.hbVerifiedAt ?? entry.hbVerifiedAt,
      hardExpiresAt,
      lastError: null,
      lastSuccessAt: nowMs,
      lastErrorAt: null,
      lastErrorCode: null,
      refreshAttempts: 0,
      updatedAt: nowMs
    }
  }

  const lastError = asError(outcome.error, nowMs)
  if (canUseStaleIfError(entry, nowMs)) {
    return {
      ...withStatus(entry, 'stale', nowMs),
      lastError,
      lastErrorAt: nowMs,
      lastErrorCode: lastError.code,
      refreshAttempts: entry.refreshAttempts + 1
    }
  }

  return {
    ...withStatus(entry, 'invalid', nowMs),
    lastError,
    lastErrorAt: nowMs,
    lastErrorCode: lastError.code,
    refreshAttempts: entry.refreshAttempts + 1
  }
}

export function applyProbeOutcome(
  current: DomainMapEntry | null,
  outcome: DomainProbeOutcome,
  host: string,
  nowMs = Date.now()
): DomainMapEntry {
  const entry = applyHardExpiry(current ?? createEmptyDomainMapEntry(host, nowMs), nowMs)

  if (outcome.kind === 'probe_success') {
    if (entry.status === 'invalid') {
      return {
        ...entry,
        hbVerifiedAt: nowMs,
        updatedAt: nowMs
      }
    }
    return {
      ...entry,
      hbVerifiedAt: nowMs,
      lastError: null,
      lastErrorAt: null,
      lastErrorCode: null,
      updatedAt: nowMs
    }
  }

  const lastError = asError(outcome.error, nowMs)
  if (canUseStaleIfError(entry, nowMs)) {
    return {
      ...withStatus(entry, 'stale', nowMs),
      lastError,
      lastErrorAt: nowMs,
      lastErrorCode: lastError.code
    }
  }

  return {
    ...withStatus(entry, 'invalid', nowMs),
    lastError,
    lastErrorAt: nowMs,
    lastErrorCode: lastError.code
  }
}

function getBaseRefreshPlan(
  current: DomainMapEntry | null,
  nowMs: number,
  options: DomainRefreshSchedulingOptions
): { reason: RefreshScheduleReason; baseRefreshAt: number } {
  const merged = { ...DEFAULT_SCHEDULING, ...options }
  if (!current) {
    return { reason: 'initial', baseRefreshAt: nowMs }
  }

  const entry = applyHardExpiry(current, nowMs)
  if (entry.status === 'valid') {
    if (entry.expiresAt === null) {
      return { reason: 'invalid_retry', baseRefreshAt: nowMs + merged.invalidRetryMs }
    }
    return {
      reason: 'valid_refresh',
      baseRefreshAt: Math.max(nowMs, entry.expiresAt - merged.validLeadMs)
    }
  }

  if (entry.status === 'stale') {
    const staleAt = nowMs + merged.staleRetryMs
    const cappedAt = entry.hardExpiresAt === null ? staleAt : Math.min(staleAt, entry.hardExpiresAt)
    return {
      reason: shouldInvalidate(entry, nowMs) ? 'hard_expired' : 'stale_retry',
      baseRefreshAt: cappedAt
    }
  }

  return {
    reason: shouldInvalidate(entry, nowMs) ? 'hard_expired' : 'invalid_retry',
    baseRefreshAt: nowMs + merged.invalidRetryMs
  }
}

function stableHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function computeJitterOffset(host: string, windowMs: number): number {
  if (windowMs <= 0) {
    return 0
  }
  const normalized = stableHash(host) / 0xffffffff
  const signed = normalized * 2 - 1
  return Math.round(windowMs * signed)
}

export function computeNextRefreshAt(
  current: DomainMapEntry | null,
  nowMs = Date.now(),
  options: DomainRefreshSchedulingOptions = {}
): number {
  return getBaseRefreshPlan(current, nowMs, options).baseRefreshAt
}

export function computeRefreshSchedulingHint(
  current: DomainMapEntry | null,
  host: string,
  nowMs = Date.now(),
  options: DomainRefreshSchedulingOptions = {}
): DomainRefreshSchedulingHint {
  const merged = { ...DEFAULT_SCHEDULING, ...options }
  const { reason, baseRefreshAt } = getBaseRefreshPlan(current, nowMs, merged)
  const distance = Math.max(0, baseRefreshAt - nowMs)
  const jitterWindowMs = Math.floor(distance * merged.jitterRatio)
  const jitterOffsetMs = computeJitterOffset(host, jitterWindowMs)
  const nextRefreshAt = Math.max(nowMs, baseRefreshAt + jitterOffsetMs)

  return {
    reason,
    baseRefreshAt,
    nextRefreshAt,
    jitterOffsetMs,
    isDue: nextRefreshAt <= nowMs
  }
}
