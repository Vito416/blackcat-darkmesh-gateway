export type IntegrityFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type IntegrityFetchControl = {
  timeoutMs: number
  retryAttempts: number
  retryBackoffMs: number
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BACKOFF_MS = 100
const MAX_RETRY_ATTEMPTS = 5
const MAX_TIMEOUT_MS = 60_000
const MAX_RETRY_BACKOFF_MS = 5_000

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

export function resolveIntegrityFetchControl(
  overrides: Partial<IntegrityFetchControl> = {},
): IntegrityFetchControl {
  const timeoutMs =
    normalizePositiveInteger(
      overrides.timeoutMs,
      readPositiveInteger(process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
      MAX_TIMEOUT_MS,
    )

  const retryAttempts =
    normalizePositiveInteger(
      overrides.retryAttempts,
      readPositiveInteger(process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS, DEFAULT_RETRY_ATTEMPTS, MAX_RETRY_ATTEMPTS),
      MAX_RETRY_ATTEMPTS,
    )

  const retryBackoffMs = normalizeNonNegativeInteger(
    overrides.retryBackoffMs,
    readPositiveInteger(process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS, DEFAULT_RETRY_BACKOFF_MS, MAX_RETRY_BACKOFF_MS),
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
