const DEFAULT_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-XSS-Protection': '0',
} as const

function isSecurityHeadersEnabled(): boolean {
  return process.env.GATEWAY_SECURITY_HEADERS_ENABLE !== '0'
}

function readCspDirective(): string {
  return (process.env.GATEWAY_SECURITY_HEADERS_CSP || '').trim()
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
