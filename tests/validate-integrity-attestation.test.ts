import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/validate-integrity-attestation.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (typeof entry !== 'undefined') {
      out[key] = canonicalize(entry)
    }
  }
  return out
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function digestForArtifact(artifact: Record<string, unknown>): string {
  const segment = {
    artifactType: artifact.artifactType,
    scriptVersionTag: artifact.scriptVersionTag,
    generatedAt: artifact.generatedAt,
    gateways: artifact.gateways,
    comparedFields: artifact.comparedFields,
    summary: artifact.summary,
  }
  return `sha256:${createHash('sha256').update(canonicalJson(segment)).digest('hex')}`
}

function buildArtifact(overrides: Record<string, unknown> = {}) {
  const artifact: Record<string, unknown> = {
    artifactType: 'gateway-integrity-attestation',
    scriptVersionTag: 'integrity-attestation-v1',
    generatedAt: '2026-04-10T10:20:30.000Z',
    gateways: [
      {
        label: '#1 gw-a.example',
        url: 'https://gw-a.example/integrity/state',
        snapshot: {
          release: { root: 'root-a', version: '1.2.0' },
          policy: { activeRoot: 'root-a', paused: false },
        },
      },
      {
        label: '#2 gw-b.example',
        url: 'https://gw-b.example/integrity/state',
        snapshot: {
          release: { root: 'root-a', version: '1.2.0' },
          policy: { activeRoot: 'root-a', paused: false },
        },
      },
    ],
    comparedFields: [
      {
        field: 'policy.paused',
        status: 'consensus',
        values: [
          { gateway: '#1 gw-a.example', url: 'https://gw-a.example/integrity/state', found: true, value: false },
          { gateway: '#2 gw-b.example', url: 'https://gw-b.example/integrity/state', found: true, value: false },
        ],
      },
      {
        field: 'release.root',
        status: 'consensus',
        values: [
          { gateway: '#1 gw-a.example', url: 'https://gw-a.example/integrity/state', found: true, value: 'root-a' },
          { gateway: '#2 gw-b.example', url: 'https://gw-b.example/integrity/state', found: true, value: 'root-a' },
        ],
      },
    ],
    summary: {
      mismatchCount: 0,
      invalidFieldCount: 0,
      gatewayCount: 2,
    },
  }

  const withDigest = { ...artifact, ...overrides }
  return { ...withDigest, digest: digestForArtifact(withDigest as Record<string, unknown>) }
}

function writeArtifactFile(artifact: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-attestation-'))
  tempDirs.push(dir)
  const file = join(dir, 'attestation.json')
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  return file
}

function runValidator(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('validate-integrity-attestation.js', () => {
  it('prints help and exits cleanly', () => {
    const res = runValidator(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--file <PATH>')
  })

  it('accepts a valid attestation artifact', () => {
    const file = writeArtifactFile(buildArtifact())
    const res = runValidator(['--file', file])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`valid attestation: ${file}`)
    expect(res.stderr).toBe('')
  })

  it('rejects a malformed attestation artifact with exit code 3', () => {
    const artifact = buildArtifact()
    artifact.summary = { ...(artifact.summary as Record<string, unknown>), gatewayCount: 3 }
    const file = writeArtifactFile(artifact)

    const res = runValidator(['--file', file])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('invalid attestation:')
    expect(res.stderr).toContain('summary.gatewayCount')
  })

  it('returns usage error when --file is missing', () => {
    const res = runValidator([])
    expect(res.status).toBe(64)
    expect(res.stderr).toContain('error: --file is required')
  })
})
