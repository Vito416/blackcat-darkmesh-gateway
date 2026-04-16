import { Buffer } from 'buffer'
import crypto from 'crypto'

function compareBuffers(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8')
  const rightBuf = Buffer.from(right, 'utf8')
  if (leftBuf.length !== rightBuf.length) return false
  return crypto.timingSafeEqual(leftBuf, rightBuf)
}

export function safeCompareAscii(left: string, right: string): boolean {
  return compareBuffers(left, right)
}

export function safeCompareHexOrAscii(left: string, right: string): boolean {
  return compareBuffers(left, right)
}
