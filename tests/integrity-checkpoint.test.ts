import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readIntegrityCheckpoint, writeIntegrityCheckpoint } from '../src/integrity/checkpoint.js'
import type { IntegritySnapshot } from '../src/integrity/types.js'
import { canonicalizeJson } from '../src/runtime/core/canonicalJson.js'

function sampleSnapshot(): IntegritySnapshot {
  return {
    release: {
      componentId: 'gateway',
      version: '1.2.0',
      root: 'root-abc',
      uriHash: 'uri-123',
      metaHash: 'meta-456',
      publishedAt: '2026-04-09T00:00:00Z',
    },
    policy: {
      activeRoot: 'root-abc',
      activePolicyHash: 'policy-789',
      paused: false,
      maxCheckInAgeSec: 3600,
    },
    authority: {
      root: 'sig-root',
      upgrade: 'sig-upgrade',
      emergency: 'sig-emergency',
      reporter: 'sig-reporter',
      signatureRefs: ['sig-root', 'sig-upgrade'],
    },
    audit: {
      seqFrom: 1,
      seqTo: 2,
      merkleRoot: 'merkle-xyz',
      metaHash: 'audit-meta',
      reporterRef: 'sig-reporter',
      acceptedAt: '2026-04-09T00:00:00Z',
    },
  }
}
const checkpointEnvKeys = [
  'GATEWAY_INTEGRITY_CHECKPOINT_PATH',
  'GATEWAY_INTEGRITY_CHECKPOINT_SECRET',
  'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS',
  'GATEWAY_INTEGRITY_DISKLESS',
  'GATEWAY_INTEGRITY_CHECKPOINT_MODE',
] as const

let checkpointEnvSnapshot: Record<(typeof checkpointEnvKeys)[number], string | undefined>

function signCheckpointBody(body: unknown, secret: string): string {
  return createHmac('sha256', secret).update(canonicalizeJson(body)).digest('hex')
}

beforeEach(() => {
  checkpointEnvSnapshot = Object.fromEntries(
    checkpointEnvKeys.map((key) => [key, process.env[key]]),
  ) as Record<(typeof checkpointEnvKeys)[number], string | undefined>
})

afterEach(() => {
  for (const key of checkpointEnvKeys) {
    const value = checkpointEnvSnapshot[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('integrity checkpoint', () => {
  it('writes and reads a signed checkpoint with metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()

    process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS = '3600'
    const written = await writeIntegrityCheckpoint(snapshot, file, 'secret-123')
    expect(written).toBe(true)

    const roundTrip = await readIntegrityCheckpoint(file, 'secret-123')
    expect(roundTrip).toEqual(snapshot)

    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.algorithm).toBe('hmac-sha256')
    expect(parsed.signature).toEqual(expect.any(String))
    expect(parsed.metadata).toMatchObject({
      writtenAt: expect.any(Number),
      expiresAt: expect.any(Number),
    })
    expect(parsed.metadata.expiresAt).toBeGreaterThan(parsed.metadata.writtenAt)
  })

  it('keeps checkpoint signatures deterministic across key order changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const fileA = join(dir, 'checkpoint-a.json')
    const fileB = join(dir, 'checkpoint-b.json')
    const secret = 'secret-123'
    const now = Date.parse('2026-04-11T00:00:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const snapshotA = sampleSnapshot()
    const snapshotB: IntegritySnapshot = {
      audit: { ...snapshotA.audit },
      authority: { ...snapshotA.authority },
      policy: { ...snapshotA.policy },
      release: { ...snapshotA.release },
    }

    await writeIntegrityCheckpoint(snapshotA, fileA, secret)
    await writeIntegrityCheckpoint(snapshotB, fileB, secret)

    const parsedA = JSON.parse(await readFile(fileA, 'utf8'))
    const parsedB = JSON.parse(await readFile(fileB, 'utf8'))

    expect(parsedA.signature).toBe(parsedB.signature)
    expect(parsedA.signature).toBe(
      signCheckpointBody(
        {
          algorithm: 'hmac-sha256',
          payload: snapshotA,
          metadata: { writtenAt: now },
        },
        secret,
      ),
    )
  })

  it('returns null when the checkpoint is tampered with', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')

    await writeIntegrityCheckpoint(sampleSnapshot(), file, 'secret-123')
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    parsed.payload.policy.paused = true
    await writeFile(file, `${JSON.stringify(parsed)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, 'secret-123')).resolves.toBeNull()
  })

  it('returns null when the checkpoint is stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()
    const secret = 'secret-123'
    const metadata = { writtenAt: Date.parse('2024-01-01T00:00:00Z') }
    const envelope = {
      algorithm: 'hmac-sha256',
      payload: snapshot,
      metadata,
      signature: signCheckpointBody(
        {
          algorithm: 'hmac-sha256',
          payload: snapshot,
          metadata,
        },
        secret,
      ),
    }

    process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS = '60'
    await writeFile(file, `${JSON.stringify(envelope)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, secret)).resolves.toBeNull()
  })

  it('returns null when the max-age config is invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()
    const secret = 'secret-123'
    const metadata = { writtenAt: Date.parse('2024-01-01T00:00:00Z') }
    const envelope = {
      algorithm: 'hmac-sha256',
      payload: snapshot,
      metadata,
      signature: signCheckpointBody(
        {
          algorithm: 'hmac-sha256',
          payload: snapshot,
          metadata,
        },
        secret,
      ),
    }

    process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS = 'not-a-number'
    await writeFile(file, `${JSON.stringify(envelope)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, secret)).resolves.toBeNull()
  })

  it('returns null when checkpoint metadata is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()
    const secret = 'secret-123'
    const metadata = { writtenAt: 'not-a-number' }
    const envelope = {
      algorithm: 'hmac-sha256',
      payload: snapshot,
      metadata,
      signature: signCheckpointBody(
        {
          algorithm: 'hmac-sha256',
          payload: snapshot,
          metadata,
        },
        secret,
      ),
    }

    await writeFile(file, `${JSON.stringify(envelope)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, secret)).resolves.toBeNull()
  })

  it('reads legacy checkpoints without metadata when max-age is not configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()
    const secret = 'secret-123'
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS
    const legacyEnvelope = {
      signature: signCheckpointBody(snapshot, secret),
      payload: snapshot,
      algorithm: 'hmac-sha256',
    }

    await writeFile(file, `${JSON.stringify(legacyEnvelope)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, secret)).resolves.toEqual(snapshot)
  })

  it('rejects legacy checkpoints without metadata when max-age is configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()
    const secret = 'secret-123'
    process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS = '3600'
    const legacyEnvelope = {
      signature: signCheckpointBody(snapshot, secret),
      payload: snapshot,
      algorithm: 'hmac-sha256',
    }

    await writeFile(file, `${JSON.stringify(legacyEnvelope)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, secret)).resolves.toBeNull()
  })

  it('no-ops when no checkpoint path is configured', async () => {
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_PATH
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_SECRET
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS

    const written = await writeIntegrityCheckpoint(sampleSnapshot())
    const roundTrip = await readIntegrityCheckpoint()

    expect(written).toBeNull()
    expect(roundTrip).toBeNull()
  })

  it('stays memory-only when diskless checkpoint mode is enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()

    process.env.GATEWAY_INTEGRITY_DISKLESS = '1'
    process.env.GATEWAY_INTEGRITY_CHECKPOINT_PATH = file
    process.env.GATEWAY_INTEGRITY_CHECKPOINT_SECRET = 'secret-123'

    const written = await writeIntegrityCheckpoint(snapshot)
    const restored = await readIntegrityCheckpoint()

    expect(written).toBeNull()
    expect(restored).toBeNull()
  })
})
