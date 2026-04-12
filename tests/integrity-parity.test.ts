import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readIntegrityCheckpoint, writeIntegrityCheckpoint } from '../src/integrity/checkpoint.js'
import { fetchIntegritySnapshot } from '../src/integrity/client.js'
import { verifyManifestEntry } from '../src/integrity/verifier.js'
import type { IntegritySnapshot } from '../src/integrity/types.js'

const originalEnv = { ...process.env }

function makeSnapshot(): IntegritySnapshot {
  return {
    release: {
      componentId: 'gateway',
      version: '1.2.0',
      root: 'root-a',
      uriHash: 'uri-a',
      metaHash: 'meta-a',
      publishedAt: '2026-04-09T00:00:00Z',
    },
    policy: {
      activeRoot: 'root-a',
      activePolicyHash: 'policy-a',
      paused: false,
      maxCheckInAgeSec: 3600,
      compatibilityState: {
        root: 'root-a',
        hash: 'compat-a',
        until: '2026-04-09T01:00:00Z',
      },
    },
    authority: {
      root: 'sig-root',
      upgrade: 'sig-upgrade',
      emergency: 'sig-emergency',
      reporter: 'sig-reporter',
      signatureRefs: ['sig-root'],
    },
    audit: {
      seqFrom: 1,
      seqTo: 1,
      merkleRoot: 'merkle-a',
      metaHash: 'audit-a',
      reporterRef: 'sig-reporter',
      acceptedAt: '2026-04-09T00:00:00Z',
    },
  }
}

function mockSnapshotFetch(snapshot: IntegritySnapshot) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type ParityCase = {
  name: string
  entry: { root?: string | null; hash?: string | null; uriHash?: string | null }
  policy: { activeRoot?: string | null; trustedRoots?: readonly string[]; expectedHash?: string | null; paused?: boolean }
  expected: { ok: boolean; code?: 'integrity_mismatch' | 'missing_trusted_root' | 'policy_paused' }
}

function assertParityCase(testCase: ParityCase) {
  expect(verifyManifestEntry(testCase.entry, testCase.policy)).toEqual(testCase.expected)
}

describe('gateway decommission integrity parity', () => {
  it('fails closed when the active snapshot has been revoked', async () => {
    const snapshot = makeSnapshot()
    snapshot.release.revokedAt = '2026-04-10T00:00:00Z'
    mockSnapshotFetch(snapshot)

    await expect(fetchIntegritySnapshot({ url: 'https://ao.example/integrity' })).rejects.toMatchObject({
      code: 'integrity_release_root_mismatch',
    })
  })

  it('fails closed when the authority block is missing from the snapshot', async () => {
    const snapshot = makeSnapshot()
    delete (snapshot as Partial<IntegritySnapshot>).authority
    mockSnapshotFetch(snapshot)

    await expect(fetchIntegritySnapshot({ url: 'https://ao.example/integrity' })).rejects.toMatchObject({
      code: 'integrity_invalid_snapshot',
    })
  })

  it('fails closed when the policy is paused', () => {
    assertParityCase({
      name: 'paused policy blocks mutating/serving paths',
      entry: { root: 'root-a', hash: 'hash-a' },
      policy: { activeRoot: 'root-a', paused: true },
      expected: { ok: false, code: 'policy_paused' },
    })
  })

  it('classifies missing trusted root as a hard failure', () => {
    assertParityCase({
      name: 'missing trusted root is not recoverable',
      entry: { hash: 'hash-a' },
      policy: { activeRoot: 'root-a' },
      expected: { ok: false, code: 'missing_trusted_root' },
    })
  })

  it('classifies root or artifact mismatch as integrity mismatch', () => {
    assertParityCase({
      name: 'revoked or mismatched integrity facts are blocked',
      entry: { root: 'revoked-root', hash: 'hash-a' },
      policy: { activeRoot: 'root-a', trustedRoots: ['root-a', 'root-b'] },
      expected: { ok: false, code: 'integrity_mismatch' },
    })
    assertParityCase({
      name: 'hash mismatch is blocked too',
      entry: { root: 'root-a', uriHash: 'hash-a' },
      policy: { activeRoot: 'root-a', expectedHash: 'hash-b' },
      expected: { ok: false, code: 'integrity_mismatch' },
    })
  })

  it('keeps the happy path explicit when policy and artifact line up', () => {
    assertParityCase({
      name: 'trusted artifact remains serveable',
      entry: { root: 'root-a', hash: 'hash-a' },
      policy: { activeRoot: 'root-a', trustedRoots: ['root-a'], expectedHash: 'hash-a' },
      expected: { ok: true },
    })
  })

  it('treats stale checkpoints as absent instead of restoring stale state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-parity-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const secret = 'checkpoint-secret'
    const snapshot = makeSnapshot()

    process.env.GATEWAY_INTEGRITY_CHECKPOINT_PATH = file
    process.env.GATEWAY_INTEGRITY_CHECKPOINT_SECRET = secret
    process.env.GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS = '60'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00Z'))

    const written = await writeIntegrityCheckpoint(snapshot, file, secret)
    expect(written).toBe(true)

    vi.setSystemTime(new Date('2026-04-09T00:02:00Z'))
    await expect(readIntegrityCheckpoint(file, secret)).resolves.toBeNull()
  })

  it('fails closed when a checkpoint signature is tampered with', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-parity-checkpoint-'))
    const file = join(dir, 'checkpoint.json')
    const secret = 'checkpoint-secret'
    const snapshot = makeSnapshot()

    await writeIntegrityCheckpoint(snapshot, file, secret)
    const raw = JSON.parse(await readFile(file, 'utf8'))
    raw.signature = '0'.repeat(String(raw.signature).length)
    await writeFile(file, `${JSON.stringify(raw)}\n`, 'utf8')

    await expect(readIntegrityCheckpoint(file, secret)).resolves.toBeNull()
  })
})
