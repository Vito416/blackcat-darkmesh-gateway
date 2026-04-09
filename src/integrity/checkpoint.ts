import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { IntegritySnapshot } from './types.js'

export type IntegrityCheckpointEnvelope = {
  payload: IntegritySnapshot
  signature: string
  algorithm: 'hmac-sha256'
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

type CheckpointOptions = {
  path?: string
  secret?: string
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

function signPayload(payload: IntegritySnapshot, secret: string): string {
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
  if (parsed.algorithm !== 'hmac-sha256') {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'unsupported checkpoint algorithm')
  }
  if (!isObject(parsed.payload)) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint payload must be an object')
  }
  if (typeof parsed.signature !== 'string' || parsed.signature.trim().length === 0) {
    throw new IntegrityCheckpointError('checkpoint_invalid', 'checkpoint signature is required')
  }

  return {
    algorithm: 'hmac-sha256',
    payload: parsed.payload as IntegritySnapshot,
    signature: parsed.signature,
  }
}

export async function writeIntegrityCheckpoint(
  snapshot: IntegritySnapshot,
  path?: string,
  secret?: string,
): Promise<boolean | null> {
  const resolvedPath = resolvePath(path)
  if (!resolvedPath) return null

  const resolvedSecret = resolveSecret(secret)
  if (!resolvedSecret) {
    throw new IntegrityCheckpointError('checkpoint_secret_missing', 'GATEWAY_INTEGRITY_CHECKPOINT_SECRET is required')
  }

  const envelope: IntegrityCheckpointEnvelope = {
    payload: snapshot,
    signature: signPayload(snapshot, resolvedSecret),
    algorithm: 'hmac-sha256',
  }

  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, `${canonicalize(envelope)}\n`, 'utf8')
  return true
}

export async function readIntegrityCheckpoint(
  path?: string,
  secret?: string,
): Promise<IntegritySnapshot | null> {
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

  const envelope = parseEnvelope(raw)
  const expected = signPayload(envelope.payload, resolvedSecret)
  if (!safeHexCompare(envelope.signature, expected)) {
    return null
  }

  return envelope.payload
}
