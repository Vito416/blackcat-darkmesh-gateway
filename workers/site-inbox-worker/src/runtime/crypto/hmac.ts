import { HTTPException } from 'hono/http-exception'

export function normalizeHmacSignature(signature: string) {
  return signature.trim().toLowerCase()
}

export function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) {
    throw new HTTPException(401, { message: 'invalid_signature' })
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
