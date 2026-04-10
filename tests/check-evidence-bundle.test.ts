import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-evidence-bundle.js', import.meta.url))
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

function buildAttestationArtifact(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }

  return { ...artifact, digest: digestForArtifact(artifact) }
}

function writeBundle(bundle: { compare?: unknown; attestation?: unknown; manifest?: unknown }) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-evidence-bundle-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, 'compare.txt'), 'compare log\n', 'utf8')
  writeFileSync(join(dir, 'attestation.json'), `${JSON.stringify(bundle.attestation ?? buildAttestationArtifact(), null, 2)}\n`, 'utf8')
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      bundle.manifest ?? {
        tool: 'scripts/export-integrity-evidence.js',
        version: 1,
        startedAt: '2026-04-10T10:20:00.000Z',
        finishedAt: '2026-04-10T10:21:00.000Z',
        baseDir: dir,
        bundleDir: dir,
        urls: ['https://gw-a.example', 'https://gw-b.example'],
        commandArgs: {
          outDir: './artifacts/evidence',
          urlCount: 2,
          tokenMode: 'env:GATEWAY_INTEGRITY_STATE_TOKEN',
          tokenCount: 0,
          hmacEnv: '',
        },
        files: {
          compareLog: 'compare.txt',
          attestation: 'attestation.json',
        },
        compare: {
          command: 'node scripts/compare-integrity-state.js ...',
          exitCode: 0,
          signal: '',
          ok: true,
        },
        attestation: {
          command: 'node scripts/generate-integrity-attestation.js ...',
          exitCode: 0,
          signal: '',
          ok: true,
        },
        status: 'ok',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return dir
}

function runChecker(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('check-evidence-bundle.js', () => {
  it('prints help and exits cleanly', () => {
    const res = runChecker(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--dir <PATH>')
  })

  it('accepts a valid bundle in non-strict mode', () => {
    const dir = writeBundle({})
    const res = runChecker(['--dir', dir])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`valid evidence bundle: ${dir}`)
    expect(res.stderr).toBe('')
  })

  it('accepts a valid bundle in strict mode', () => {
    const dir = writeBundle({})
    const res = runChecker(['--dir', dir, '--strict'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`valid evidence bundle: ${dir} (strict)`)
  })

  it('rejects a bundle when a required file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-evidence-bundle-missing-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'attestation.json'), `${JSON.stringify(buildAttestationArtifact(), null, 2)}\n`, 'utf8')
    writeFileSync(join(dir, 'manifest.json'), '{}\n', 'utf8')

    const res = runChecker(['--dir', dir])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('missing required file(s): compare.txt')
  })

  it('rejects a bundle when manifest is incomplete', () => {
    const dir = writeBundle({
      manifest: {
        status: 'ok',
        urls: ['https://gw-a.example', 'https://gw-b.example'],
        compare: { exitCode: 0 },
      },
    })

    const res = runChecker(['--dir', dir])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('manifest.json is missing required key: attestation')
  })

  it('rejects a bundle in strict mode when the manifest is not ok', () => {
    const dir = writeBundle({
      manifest: {
        tool: 'scripts/export-integrity-evidence.js',
        version: 1,
        startedAt: '2026-04-10T10:20:00.000Z',
        finishedAt: '2026-04-10T10:21:00.000Z',
        baseDir: dirPlaceholder(),
        bundleDir: dirPlaceholder(),
        urls: ['https://gw-a.example', 'https://gw-b.example'],
        compare: { exitCode: 0 },
        attestation: { exitCode: 0 },
        status: 'failed',
      },
    })

    const res = runChecker(['--dir', dir, '--strict'])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('manifest.status must be "ok" in strict mode')
  })

  it('rejects a bundle when attestation validation fails', () => {
    const attestation = buildAttestationArtifact({ summary: { mismatchCount: 1, invalidFieldCount: 0, gatewayCount: 2 } })
    const dir = writeBundle({ attestation })

    const res = runChecker(['--dir', dir])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('attestation validator rejected bundle:')
  })
})

function dirPlaceholder() {
  return '/tmp/gateway-evidence-bundle'
}
