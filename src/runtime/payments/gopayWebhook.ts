import crypto from 'crypto'
import { safeCompareHexOrAscii } from '../crypto/safeCompare.js'

export function verifyGoPayWebhook(body: string, signatureHeader: string | null, secret: string): boolean {
  if (!body || !signatureHeader || !secret) return false

  const signature = signatureHeader.trim()
  if (!signature) return false

  const normalized = signature.startsWith('sha256=') ? signature.slice('sha256='.length).trim() : signature
  if (!normalized) return false

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return safeCompareHexOrAscii(expected, normalized)
}
