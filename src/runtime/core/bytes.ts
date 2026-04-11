export function readPositiveInteger(raw: string | undefined, fallback: number, min = 1): number {
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  const lowerBound = Number.isFinite(min) ? Math.max(1, Math.floor(min)) : 1
  if (!Number.isFinite(parsed) || parsed < lowerBound) return fallback
  return parsed
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function bodyExceedsUtf8Limit(body: string, limitBytes: number): boolean {
  return utf8ByteLength(body) > limitBytes
}
