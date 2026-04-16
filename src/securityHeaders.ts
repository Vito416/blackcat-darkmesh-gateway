import { loadStringConfig } from './runtime/config/loader.js'

const DEFAULT_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-XSS-Protection': '0',
  'Strict-Transport-Security': 'max-age=31536000',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const

function isSecurityHeadersEnabled(): boolean {
  const loaded = loadStringConfig('GATEWAY_SECURITY_HEADERS_ENABLE')
  if (!loaded.ok) return true
  return loaded.value !== '0'
}

function readCspDirective(): string {
  const loaded = loadStringConfig('GATEWAY_SECURITY_HEADERS_CSP')
  if (!loaded.ok) return ''
  return typeof loaded.value === 'string' ? loaded.value.trim() : ''
}

export function applySecurityHeaders(response: Response): Response {
  if (!isSecurityHeadersEnabled()) return response

  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value)
  }

  const csp = readCspDirective()
  if (csp) headers.set('Content-Security-Policy', csp)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
