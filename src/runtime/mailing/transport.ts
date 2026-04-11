export type MailTransportRequest = {
  to: string[]
  subject: string
  body: string
  requestId?: string
}

export type MailTransportResult = {
  ok: boolean
  status: number
  error?: string
}

type MailTransportOptions = {
  endpoint: string
  token?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

type MailTransport = {
  send: (request: MailTransportRequest) => Promise<MailTransportResult>
}

const DEFAULT_TIMEOUT_MS = 5000

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return DEFAULT_TIMEOUT_MS
  return Math.floor(value)
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

export function createMailTransport(opts: MailTransportOptions): MailTransport {
  const endpoint = typeof opts.endpoint === 'string' ? opts.endpoint.trim() : ''
  if (!endpoint) throw new Error('mail transport endpoint is required')

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('mail transport fetch implementation is required')

  const token = typeof opts.token === 'string' && opts.token.trim() ? opts.token.trim() : undefined
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs)

  return {
    async send(request: MailTransportRequest): Promise<MailTransportResult> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        })

        if (response.ok) {
          return { ok: true, status: response.status }
        }

        return {
          ok: false,
          status: response.status,
          error: `mail transport failed with status ${response.status}`,
        }
      } catch (error) {
        if (isAbortError(error)) {
          return {
            ok: false,
            status: 408,
            error: 'mail transport request timed out',
          }
        }

        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : 'mail transport request failed',
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
