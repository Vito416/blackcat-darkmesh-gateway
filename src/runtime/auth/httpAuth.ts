import { Buffer } from 'buffer'
import crypto from 'crypto'

export function readBearerToken(request: Request): string {
  const auth = request.headers.get('authorization') || ''
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  return ''
}

export function readHeaderToken(request: Request, headerName: string): string {
  return (request.headers.get(headerName) || '').trim()
}

export function tokenEquals(expected: string, presented: string): boolean {
  if (!expected || !presented) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function checkToken(request: Request, expectedToken: string, headerName: string): boolean {
  const bearer = readBearerToken(request)
  const header = readHeaderToken(request, headerName)
  return tokenEquals(expectedToken, bearer) || tokenEquals(expectedToken, header)
}

export function basicCredentialsMatch(expectedUser: string, expectedPass: string, presented: string): boolean {
  if (!presented || !/^Basic\s+/i.test(presented)) return false
  try {
    const b64 = presented.replace(/^Basic\s+/i, '')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    const colonIndex = decoded.indexOf(':')
    if (colonIndex <= 0) return false
    const user = decoded.slice(0, colonIndex)
    const pass = decoded.slice(colonIndex + 1)
    return tokenEquals(expectedUser, user) && tokenEquals(expectedPass, pass)
  } catch (_) {
    return false
  }
}
