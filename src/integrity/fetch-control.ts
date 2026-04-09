export type IntegrityFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type IntegrityFetchControl = {
  timeoutMs: number
  retryAttempts: number
  retryBackoffMs: number
}

type GatewayResourceProfile = 'wedos_small' | 'wedos_medium' | 'diskless'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BACKOFF_MS = 100
const MAX_RETRY_ATTEMPTS = 5
const MAX_TIMEOUT_MS = 60_000
const MAX_RETRY_BACKOFF_MS = 5_000

const PROFILE_DEFAULTS: Record<GatewayResourceProfile, IntegrityFetchControl> = {
  wedos_small: { timeoutMs: 4000, retryAttempts: 2, retryBackoffMs: 75 },
  wedos_medium: { timeoutMs: DEFAULT_TIMEOUT_MS, retryAttempts: DEFAULT_RETRY_ATTEMPTS, retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS },
  diskless: { timeoutMs: 4000, retryAttempts: 2, retryBackoffMs: 75 },
}

function readPositiveInteger(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback
  return Math.min(Math.floor(value), max)
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback
  return Math.min(Math.floor(value), max)
}

function resolveResourceProfile(raw: string | undefined): GatewayResourceProfile | null {
  const value = (raw || '').trim().toLowerCase()
  if (!value) return null
  if (value === 'wedos-small' || value === 'small' || value === 's' || value === 'wedos_small') return 'wedos_small'
  if (value === 'wedos-medium' || value === 'medium' || value === 'm' || value === 'default' || value === 'wedos_medium') return 'wedos_medium'
  if (value === 'diskless' || value === 'memory-only' || value === 'memory_only' || value === 'ephemeral') return 'diskless'
  return null
}

export function resolveIntegrityFetchControl(
  overrides: Partial<IntegrityFetchControl> = {},
): IntegrityFetchControl {
  const profile = resolveResourceProfile(process.env.GATEWAY_RESOURCE_PROFILE)
  const profileDefaults = profile ? PROFILE_DEFAULTS[profile] : PROFILE_DEFAULTS.wedos_medium

  const timeoutMs =
    normalizePositiveInteger(
      overrides.timeoutMs,
      readPositiveInteger(process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS, profileDefaults.timeoutMs, MAX_TIMEOUT_MS),
      MAX_TIMEOUT_MS,
    )

  const retryAttempts =
    normalizePositiveInteger(
      overrides.retryAttempts,
      readPositiveInteger(process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS, profileDefaults.retryAttempts, MAX_RETRY_ATTEMPTS),
      MAX_RETRY_ATTEMPTS,
    )

  const retryBackoffMs = normalizeNonNegativeInteger(
    overrides.retryBackoffMs,
    readPositiveInteger(process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS, profileDefaults.retryBackoffMs, MAX_RETRY_BACKOFF_MS),
    MAX_RETRY_BACKOFF_MS,
  )

  return {
    timeoutMs,
    retryAttempts,
    retryBackoffMs,
  }
}

export function isTransientIntegrityFetchStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

export function getIntegrityRetryDelayMs(retryBackoffMs: number, attempt: number): number {
  if (retryBackoffMs <= 0 || attempt < 1) return 0
  const delay = retryBackoffMs * 2 ** (attempt - 1)
  return Math.min(delay, MAX_RETRY_BACKOFF_MS)
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
