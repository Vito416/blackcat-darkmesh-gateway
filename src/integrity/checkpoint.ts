import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { loadIntegerConfig, loadStringConfig } from '../runtime/config/loader.js'
import { canonicalizeJson } from '../runtime/core/canonicalJson.js'
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
  if (readCheckpointEnvString('GATEWAY_INTEGRITY_DISKLESS') === '1') return true
  const rawMode = (readCheckpointEnvString('GATEWAY_INTEGRITY_CHECKPOINT_MODE') || '').toLowerCase()
  return rawMode === 'disabled' || rawMode === 'diskless' || rawMode === 'memory-only'
}

function resolvePath(path?: string): string | undefined {
  const value = path || readCheckpointEnvString('GATEWAY_INTEGRITY_CHECKPOINT_PATH')
  return value && value.trim().length > 0 ? value : undefined
}

function resolveSecret(secret?: string): string | undefined {
  const value = secret || readCheckpointEnvString('GATEWAY_INTEGRITY_CHECKPOINT_SECRET')
  return value && value.trim().length > 0 ? value : undefined
}

function readCheckpointEnvString(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok || typeof loaded.value !== 'string') return undefined
  const value = loaded.value.trim()
  return value.length > 0 ? value : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveMaxAgeSeconds(): number | null | undefined {
  const loaded = loadIntegerConfig('GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS')
  if (!loaded.ok) return null
  if (loaded.value === undefined) return undefined
  if (!Number.isSafeInteger(loaded.value) || loaded.value <= 0) return null
  return loaded.value
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
  return createHmac('sha256', secret).update(canonicalizeJson(body)).digest('hex')
}

function signLegacyPayload(payload: IntegritySnapshot, secret: string): string {
  return createHmac('sha256', secret).update(canonicalizeJson(payload)).digest('hex')
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
  await writeFile(resolvedPath, `${canonicalizeJson(envelope)}\n`, 'utf8')
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
    // Fail closed when max-age policy is enabled but legacy envelope metadata is absent.
    return null
  }

  return envelope.payload
}
