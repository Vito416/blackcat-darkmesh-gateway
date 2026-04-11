export type AuthSdkClientOptions = {
  baseUrl: string
  token?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  hostAllowlist?: readonly string[]
}

type AuthSdkResult = {
  ok: boolean
  status: number
  body: unknown
}

const DEFAULT_TIMEOUT_MS = 5000

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

function normalizeToken(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeBaseUrl(baseUrlRaw: string): URL {
  const trimmed = baseUrlRaw.trim()
  if (!trimmed) {
    throw new Error('auth sdk client baseUrl is required')
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(trimmed)
  } catch {
    throw new Error('auth sdk client baseUrl must be a valid URL')
  }

  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('auth sdk client baseUrl must use http or https')
  }

  if (baseUrl.username || baseUrl.password) {
    throw new Error('auth sdk client baseUrl must not include credentials')
  }

  if (!baseUrl.hostname) {
    throw new Error('auth sdk client baseUrl host is required')
  }

  return baseUrl
}

function normalizeHostAllowlist(hostAllowlist?: readonly string[]): string[] | undefined {
  if (!hostAllowlist?.length) return undefined

  const normalized = hostAllowlist
    .map((host) => (typeof host === 'string' ? host.trim().toLowerCase() : ''))
    .filter((host) => host.length > 0)

  return normalized.length > 0 ? [...new Set(normalized)] : undefined
}

function validateHostAllowlist(baseUrl: URL, hostAllowlist?: readonly string[]): void {
  const normalizedAllowlist = normalizeHostAllowlist(hostAllowlist)
  if (!normalizedAllowlist) return

  const host = baseUrl.host.toLowerCase()
  if (normalizedAllowlist.includes(host)) return

  throw new Error(`auth sdk client baseUrl host is not allowed: ${host}`)
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

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const normalized = contentType.toLowerCase()
  return normalized.includes('/json') || normalized.includes('+json')
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  if (isJsonContentType(response.headers.get('content-type'))) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

function errorResult(error: string): AuthSdkResult {
  return {
    ok: false,
    status: 0,
    body: {
      error,
    },
  }
}

export function createAuthSdkClient(opts: AuthSdkClientOptions) {
  const baseUrlRaw = typeof opts?.baseUrl === 'string' ? opts.baseUrl : ''
  const baseUrl = normalizeBaseUrl(baseUrlRaw)
  validateHostAllowlist(baseUrl, opts.hostAllowlist)

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('auth sdk client fetchImpl is required')
  }

  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS
  const authToken = normalizeToken(opts.token)

  async function request(path: string, init: Omit<RequestInit, 'signal'>): Promise<AuthSdkResult> {
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
        body: await readBody(response),
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
    async health(): Promise<{ ok: boolean; status: number }> {
      const result = await request('/health', { method: 'GET' })
      return {
        ok: result.ok,
        status: result.status,
      }
    },

    async introspectToken(token: string): Promise<{ ok: boolean; status: number; body: unknown }> {
      const normalizedToken = normalizeToken(token)
      if (!normalizedToken) {
        return errorResult('token_required')
      }

      return request('/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token: normalizedToken }),
      })
    },
  }
}
