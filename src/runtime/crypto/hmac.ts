import crypto from 'crypto'

import { safeCompareAscii } from './safeCompare.js'

export type HmacVerificationOptions = {
  algorithm?: string
  digestEncoding?: crypto.BinaryToTextEncoding
  prefix?: string
}

function normalizePresentedSignature(value: unknown, prefix: string): string {
  if (typeof value !== 'string') return ''

  const trimmed = value.trim()
  if (!trimmed) return ''

  if (!prefix) return trimmed
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
  return trimmed
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function verifyHmacSignature(
  body: unknown,
  signatureHeader: unknown,
  secret: unknown,
  options: HmacVerificationOptions = {},
): boolean {
  if (!isNonEmptyString(body) || !isNonEmptyString(secret)) return false

  const presented = normalizePresentedSignature(signatureHeader, options.prefix || '')
  if (!presented) return false

  try {
    const expected = crypto
      .createHmac(options.algorithm || 'sha256', secret)
      .update(body)
      .digest(options.digestEncoding || 'hex')

    return safeCompareAscii(expected, presented)
  } catch (_) {
    return false
  }
}
