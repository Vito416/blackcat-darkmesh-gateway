import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readIntegrityCheckpoint, writeIntegrityCheckpoint } from '../src/integrity/checkpoint.js'
import type { IntegritySnapshot } from '../src/integrity/types.js'

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('integrity checkpoint', () => {
  it('writes and reads a signed checkpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const snapshot = sampleSnapshot()

    const written = await writeIntegrityCheckpoint(snapshot, file, 'secret-123')
    expect(written).toBe(true)

    const roundTrip = await readIntegrityCheckpoint(file, 'secret-123')
    expect(roundTrip).toEqual(snapshot)

    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.algorithm).toBe('hmac-sha256')
    expect(parsed.signature).toEqual(expect.any(String))
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

  it('no-ops when no checkpoint path is configured', async () => {
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_PATH
    delete process.env.GATEWAY_INTEGRITY_CHECKPOINT_SECRET

    const written = await writeIntegrityCheckpoint(sampleSnapshot())
    const roundTrip = await readIntegrityCheckpoint()

    expect(written).toBeNull()
    expect(roundTrip).toBeNull()
  })
})
