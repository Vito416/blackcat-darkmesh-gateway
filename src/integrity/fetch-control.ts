import {
  normalizeBoundedInteger,
  resolveGatewayResourceProfile,
  type GatewayResourceProfile,
} from '../runtime/config/profile.js'
import { loadIntegerConfig, loadStringConfig } from '../runtime/config/loader.js'

export type IntegrityFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type IntegrityFetchControl = {
  timeoutMs: number
  retryAttempts: number
  retryBackoffMs: number
  retryJitterMs: number
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BACKOFF_MS = 100
const DEFAULT_RETRY_JITTER_MS = 25
const MAX_RETRY_ATTEMPTS = 5
const MAX_TIMEOUT_MS = 60_000
const MAX_RETRY_BACKOFF_MS = 5_000
const MAX_RETRY_JITTER_MS = 500

const PROFILE_DEFAULTS: Record<GatewayResourceProfile, IntegrityFetchControl> = {
  vps_small: { timeoutMs: 4000, retryAttempts: 2, retryBackoffMs: 75, retryJitterMs: DEFAULT_RETRY_JITTER_MS },
  vps_medium: {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
    retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
  },
  diskless: { timeoutMs: 4000, retryAttempts: 2, retryBackoffMs: 75, retryJitterMs: DEFAULT_RETRY_JITTER_MS },
}

export function resolveIntegrityFetchControl(
  overrides: Partial<IntegrityFetchControl> = {},
): IntegrityFetchControl {
  const profileLoaded = loadStringConfig('GATEWAY_RESOURCE_PROFILE')
  const profile = resolveGatewayResourceProfile(profileLoaded.ok ? profileLoaded.value : undefined)
  const profileDefaults = profile ? PROFILE_DEFAULTS[profile] : PROFILE_DEFAULTS.vps_medium

  function readBoundedInteger(name: string, fallback: number, min: number, max: number): number {
    const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
    const value = loaded.ok && typeof loaded.value === 'number' ? loaded.value : fallback
    return normalizeBoundedInteger(value, fallback, min, max)
  }

  const timeoutMs = normalizeBoundedInteger(
    overrides.timeoutMs,
    readBoundedInteger('AO_INTEGRITY_FETCH_TIMEOUT_MS', profileDefaults.timeoutMs, 1, MAX_TIMEOUT_MS),
    1,
    MAX_TIMEOUT_MS,
  )

  const retryAttempts = normalizeBoundedInteger(
    overrides.retryAttempts,
    readBoundedInteger('AO_INTEGRITY_FETCH_RETRY_ATTEMPTS', profileDefaults.retryAttempts, 1, MAX_RETRY_ATTEMPTS),
    1,
    MAX_RETRY_ATTEMPTS,
  )

  const retryBackoffMs = normalizeBoundedInteger(
    overrides.retryBackoffMs,
    readBoundedInteger('AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS', profileDefaults.retryBackoffMs, 0, MAX_RETRY_BACKOFF_MS),
    0,
    MAX_RETRY_BACKOFF_MS,
  )

  const retryJitterMs = normalizeBoundedInteger(
    overrides.retryJitterMs,
    readBoundedInteger('AO_INTEGRITY_FETCH_RETRY_JITTER_MS', profileDefaults.retryJitterMs, 0, MAX_RETRY_JITTER_MS),
    0,
    MAX_RETRY_JITTER_MS,
  )

  return {
    timeoutMs,
    retryAttempts,
    retryBackoffMs,
    retryJitterMs,
  }
}

export function isTransientIntegrityFetchStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function normalizeRetryJitterSample(random: () => number): number {
  const sample = random()
  if (!Number.isFinite(sample) || sample < 0) return 0
  if (sample >= 1) return 0.9999999999999999
  return sample
}

export function getIntegrityRetryDelayMs(
  retryBackoffMs: number,
  attempt: number,
  retryJitterMs = 0,
  random: () => number = Math.random,
): number {
  if (retryBackoffMs <= 0 || attempt < 1) return 0
  const delay = retryBackoffMs * 2 ** (attempt - 1)
  const jitterCap = normalizeBoundedInteger(retryJitterMs, 0, 0, MAX_RETRY_JITTER_MS)
  const jitter = jitterCap > 0 ? Math.floor(normalizeRetryJitterSample(random) * (jitterCap + 1)) : 0
  return Math.min(delay + jitter, MAX_RETRY_BACKOFF_MS)
}

export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

export async function fetchWithTimeout(
  fetchImpl: IntegrityFetchLike,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetchImpl(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}
