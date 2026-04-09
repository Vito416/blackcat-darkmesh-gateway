import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { IntegritySnapshot } from './types.js'

export type IntegrityCheckpointMetadata = {
  writtenAt: number
  expiresAt?: number
}

export type IntegrityCheckpointEnvelope = {
  payload: IntegritySnapshot
  signature: string
  algorithm: 'hmac-sha256'
  metadata?: IntegrityCheckpointMetadata
}

export type IntegrityCheckpointErrorCode =
  | 'checkpoint_secret_missing'
  | 'checkpoint_invalid'
  | 'checkpoint_signature_invalid'

export class IntegrityCheckpointError extends Error {
  code: IntegrityCheckpointErrorCode

  constructor(code: IntegrityCheckpointErrorCode, message: string) {
    super(message)
    this.name = 'IntegrityCheckpointError'
    this.code = code
  }
}

type CheckpointEnvelopeBody = {
  algorithm: 'hmac-sha256'
  payload: IntegritySnapshot
  metadata?: IntegrityCheckpointMetadata
}

function isDisklessCheckpointMode(): boolean {
  if (process.env.GATEWAY_INTEGRITY_DISKLESS === '1') return true
  const rawMode = (process.env.GATEWAY_INTEGRITY_CHECKPOINT_MODE || '').trim().toLowerCase()
  return rawMode === 'disabled' || rawMode === 'diskless' || rawMode === 'memory-only'
}

function resolvePath(path?: string): string | undefined {
  const value = path || process.env.GATEWAY_INTEGRITY_CHECKPOINT_PATH
  return value && value.trim().length > 0 ? value : undefined
}

function resolveSecret(secret?: string): string | undefined {
  const value = secret || process.env.GATEWAY_INTEGRITY_CHECKPOINT_SECRET
  return value && value.trim().length > 0 ? value : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortValue(entry))
  if (!isObject(value)) return value

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortValue(value[key])
  }
  return sorted
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function resolveMaxAgeSeconds(): number | null | undefined {
  const raw = process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS
  if (raw === undefined || raw.trim().length === 0) return undefined

  const trimmed = raw.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null

  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
  return parsed
}

function isValidCheckpointMetadata(value: unknown): value is IntegrityCheckpointMetadata {
  if (!isObject(value)) return false

  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'writtenAt' && key !== 'expiresAt')) return false
  const writtenAt = value.writtenAt
  if (typeof writtenAt !== 'number' || !Number.isFinite(writtenAt) || !Number.isInteger(writtenAt) || writtenAt < 0) {
    return false
  }
  const expiresAt = value.expiresAt
  if (expiresAt !== undefined) {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || !Number.isInteger(expiresAt) || expiresAt < 0) {
      return false
    }
    if (expiresAt < writtenAt) return false
  }

  return true
}

function signEnvelopeBody(body: CheckpointEnvelopeBody, secret: string): string {
  return createHmac('sha256', secret).update(canonicalize(body)).digest('hex')
}

function signLegacyPayload(payload: IntegritySnapshot, secret: string): string {
  return createHmac('sha256', secret).update(canonicalize(payload)).digest('hex')
}

function safeHexCompare(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  const leftBuf = Buffer.from(left, 'hex')
  const rightBuf = Buffer.from(right, 'hex')
  if (leftBuf.length !== rightBuf.length) return false
  return timingSafeEqual(leftBuf, rightBuf)
}

function parseEnvelope(raw: string): IntegrityCheckpointEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new IntegrityCheckpointError('checkpoint_invalid', error instanceof Error ? error.message : 'invalid json')
  }

  if (!isObject(parsed)) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint must be a JSON object')
  }
  const allowedKeys = new Set(['algorithm', 'payload', 'signature', 'metadata'])
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint contains unsupported fields')
  }
  if (parsed.algorithm !== 'hmac-sha256') {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'unsupported checkpoint algorithm')
  }
  if (!isObject(parsed.payload)) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint payload must be an object')
  }
  if (typeof parsed.signature !== 'string' || parsed.signature.trim().length === 0) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint signature is required')
  }
  if (parsed.metadata !== undefined && !isValidCheckpointMetadata(parsed.metadata)) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint metadata is invalid')
  }

  return {
    algorithm: 'hmac-sha256',
    payload: parsed.payload as IntegritySnapshot,
    signature: parsed.signature,
    metadata: parsed.metadata as IntegrityCheckpointMetadata | undefined,
  }
}

export async function writeIntegrityCheckpoint(
  snapshot: IntegritySnapshot,
  path?: string,
  secret?: string,
): Promise<boolean | null> {
  if (isDisklessCheckpointMode()) return null

  const resolvedPath = resolvePath(path)
  if (!resolvedPath) return null

  const resolvedSecret = resolveSecret(secret)
  if (!resolvedSecret) {
    throw new IntegrityCheckpointError('checkpoint_secret_missing', 'GATEWAY_INTEGRITY_CHECKPOINT_SECRET is required')
  }

  const now = Date.now()
  const maxAgeSeconds = resolveMaxAgeSeconds()
  const metadata: IntegrityCheckpointMetadata = { writtenAt: now }
  if (typeof maxAgeSeconds === 'number') {
    metadata.expiresAt = now + maxAgeSeconds * 1000
  }

  const body: CheckpointEnvelopeBody = {
    algorithm: 'hmac-sha256',
    payload: snapshot,
    metadata,
  }
  const envelope: IntegrityCheckpointEnvelope = {
    payload: snapshot,
    signature: signEnvelopeBody(body, resolvedSecret),
    algorithm: 'hmac-sha256',
    metadata,
  }

  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, `${canonicalize(envelope)}\n`, 'utf8')
  return true
}

export async function readIntegrityCheckpoint(
  path?: string,
  secret?: string,
): Promise<IntegritySnapshot | null> {
  if (isDisklessCheckpointMode()) return null

  const resolvedPath = resolvePath(path)
  if (!resolvedPath) return null

  const resolvedSecret = resolveSecret(secret)
  if (!resolvedSecret) {
    throw new IntegrityCheckpointError('checkpoint_secret_missing', 'GATEWAY_INTEGRITY_CHECKPOINT_SECRET is required')
  }

  let raw: string
  try {
    raw = await readFile(resolvedPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new IntegrityCheckpointError('checkpoint_invalid', error instanceof Error ? error.message : 'read failed')
  }

  let envelope: IntegrityCheckpointEnvelope
  try {
    envelope = parseEnvelope(raw)
  } catch (error) {
    if (error instanceof IntegrityCheckpointError && error.code === 'checkpoint_invalid') {
      return null
    }
    throw error
  }

  const maxAgeSeconds = resolveMaxAgeSeconds()
  if (maxAgeSeconds === null) return null

  const expected = envelope.metadata
    ? signEnvelopeBody(
        {
          algorithm: envelope.algorithm,
          payload: envelope.payload,
          metadata: envelope.metadata,
        },
        resolvedSecret,
      )
    : signLegacyPayload(envelope.payload, resolvedSecret)
  if (!safeHexCompare(envelope.signature, expected)) return null

  if (envelope.metadata) {
    const now = Date.now()
    const ageMs = now - envelope.metadata.writtenAt
    if (!Number.isFinite(ageMs) || ageMs < 0) return null
    if (ageMs > maxAgeSeconds * 1000) return null
    if (envelope.metadata.expiresAt !== undefined && now >= envelope.metadata.expiresAt) return null
  } else if (maxAgeSeconds !== undefined) {
    return null
  }

  return envelope.payload
}
