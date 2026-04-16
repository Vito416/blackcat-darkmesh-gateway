import { createHash } from 'node:crypto'

import { canonicalizeJson } from './canonicalJson.js'

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(toBytes(input)).digest('hex')
}

export function sha256Utf8(text: string): string {
  return sha256Hex(text)
}

export function hashJsonCanonical(
  value: unknown,
  canonicalizeFn: (input: unknown) => string = canonicalizeJson,
): string {
  return sha256Utf8(canonicalizeFn(value))
}
