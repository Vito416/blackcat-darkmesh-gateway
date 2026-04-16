export type CryptoSdkClientOptions = {
  baseUrl: string
  token?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  allowedHosts?: string[]
}

type VerifyEnvelopeInput = {
  envelope: unknown
  context?: string
}

type HealthResult = {
  ok: boolean
  status: number
}

type VerifyEnvelopeResult = {
  ok: boolean
  status: number
  body: unknown
}

const DEFAULT_TIMEOUT_MS = 5000
type CryptoSdkResult = {
  ok: boolean
  status: number
  body: unknown
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

function normalizeToken(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeAllowedHosts(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value) => value.length > 0)
}

function validateBaseUrl(rawBaseUrl: string, allowedHosts: string[]): URL {
  const baseUrl = new URL(rawBaseUrl)
  if (baseUrl.protocol !== 'https:') {
    throw new Error('crypto sdk client baseUrl must use https')
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error('crypto sdk client baseUrl must not include credentials')
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(baseUrl.hostname.toLowerCase())) {
    throw new Error('crypto sdk client baseUrl host is not in the allowlist')
  }
  return baseUrl
}

function joinUrl(baseUrl: URL, path: string): string {
  const prefix = baseUrl.pathname.replace(/\/+$/u, '')
  const suffix = path.replace(/^\/+|\/+$/gu, '')
  const joinedPath = `${prefix}/${suffix}`.replace(/\/{2,}/gu, '/')

  const url = new URL(baseUrl.toString())
  url.pathname = joinedPath.startsWith('/') ? joinedPath : `/${joinedPath}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function normalizeTimeoutMs(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs) || (timeoutMs as number) <= 0) return DEFAULT_TIMEOUT_MS
  return Number(timeoutMs)
}

function errorResult(error: string): CryptoSdkResult {
  return {
    ok: false,
    status: 0,
    body: {
      error,
    },
  }
}

function hasRequiredEnvelope(input: VerifyEnvelopeInput): boolean {
  if (!input || typeof input !== 'object') return false
  return 'envelope' in input && (input as { envelope?: unknown }).envelope !== undefined
}

async function readResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return null

  const contentType = response.headers.get('content-type')?.toLowerCase() || ''
  const looksJson = contentType.includes('application/json') || contentType.includes('+json')
  if (!looksJson) return raw

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

export function createCryptoSdkClient(opts: CryptoSdkClientOptions) {
  const baseUrlRaw = typeof opts?.baseUrl === 'string' ? opts.baseUrl.trim() : ''
  if (!baseUrlRaw) {
    throw new Error('crypto sdk client baseUrl is required')
  }
  const allowedHosts = normalizeAllowedHosts(opts.allowedHosts)
  const baseUrl = validateBaseUrl(baseUrlRaw, allowedHosts)

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('crypto sdk client fetchImpl is required')
  }

  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs)
  const authToken = normalizeToken(opts.token)

  async function request(path: string, init: Omit<RequestInit, 'signal'>): Promise<CryptoSdkResult> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (authToken) {
      headers.set('authorization', `Bearer ${authToken}`)
    }

    try {
      const response = await fetchImpl(joinUrl(baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
      })
      return {
        ok: response.ok,
        status: response.status,
        body: await readResponseBody(response),
      }
    } catch (error) {
      if (timedOut || isAbortError(error)) {
        return errorResult('timeout')
      }
      return errorResult('network_failure')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async health(): Promise<HealthResult> {
      const result = await request('/health', {
        method: 'GET',
      })

      return {
        ok: result.ok,
        status: result.status,
      }
    },

    async verifyEnvelope(input: VerifyEnvelopeInput): Promise<VerifyEnvelopeResult> {
      if (!hasRequiredEnvelope(input)) {
        return errorResult('envelope_required')
      }

      const payload: Record<string, unknown> = {
        envelope: input.envelope,
      }
      if (input.context !== undefined) {
        payload.context = input.context
      }

      const result = await request('/api/crypto/verify-envelope', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      return result
    },
  }
}
