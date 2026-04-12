import { afterEach, describe, expect, it } from 'vitest'
import { applySecurityHeaders } from '../src/securityHeaders.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('security headers helper', () => {
  it('adds the baseline headers by default and preserves existing headers', async () => {
    delete process.env.GATEWAY_SECURITY_HEADERS_ENABLE
    delete process.env.GATEWAY_SECURITY_HEADERS_CSP

    const input = new Response('ok', {
      status: 201,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-frame-options': 'SAMEORIGIN',
      },
    })
    const output = applySecurityHeaders(input)

    expect(output.status).toBe(201)
    expect(await output.text()).toBe('ok')
    expect(output.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(output.headers.get('x-content-type-options')).toBe('nosniff')
    expect(output.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(output.headers.get('referrer-policy')).toBe('no-referrer')
    expect(output.headers.get('x-xss-protection')).toBe('0')
    expect(output.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(output.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(output.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(output.headers.get('content-security-policy')).toBeNull()
  })

  it('returns the original response unchanged when disabled', async () => {
    process.env.GATEWAY_SECURITY_HEADERS_ENABLE = '0'

    const input = new Response('disabled', {
      status: 202,
      headers: {
        'x-frame-options': 'SAMEORIGIN',
      },
    })
    const output = applySecurityHeaders(input)

    expect(output.status).toBe(202)
    expect(await output.text()).toBe('disabled')
    expect(output.headers.get('x-content-type-options')).toBeNull()
    expect(output.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(output.headers.get('strict-transport-security')).toBeNull()
  })

  it('applies csp from env even when the response already has one', () => {
    process.env.GATEWAY_SECURITY_HEADERS_CSP = "  default-src 'self'  "

    const input = new Response('csp', {
      headers: {
        'content-security-policy': "default-src 'none'",
      },
    })
    const output = applySecurityHeaders(input)

    expect(output.headers.get('content-security-policy')).toBe("default-src 'self'")
  })

  it('treats any enable value other than exact 0 as enabled', () => {
    process.env.GATEWAY_SECURITY_HEADERS_ENABLE = 'false'

    const input = new Response('enabled', { headers: { 'x-frame-options': 'SAMEORIGIN' } })
    const output = applySecurityHeaders(input)

    expect(output.headers.get('x-content-type-options')).toBe('nosniff')
    expect(output.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })
})
