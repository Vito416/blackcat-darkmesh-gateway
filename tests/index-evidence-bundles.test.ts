import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { digestForIntegrityAttestationArtifact } from './helpers/integrity-attestation.js'

const scriptPath = fileURLToPath(new URL('../scripts/index-evidence-bundles.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

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

  return { ...artifact, digest: digestForIntegrityAttestationArtifact(artifact) }
}

function writeBundle(root: string, name: string, options: { status?: string; compareExit?: number; attestationExit?: number; digest?: string } = {}) {
  const dir = join(root, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const artifact = buildAttestationArtifact()
  if (options.digest) artifact.digest = options.digest
  writeFileSync(join(dir, 'compare.txt'), 'compare log\n', 'utf8')
  writeFileSync(join(dir, 'attestation.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        tool: 'scripts/export-integrity-evidence.js',
        version: 1,
        startedAt: '2026-04-10T10:20:00.000Z',
        finishedAt: '2026-04-10T10:21:00.000Z',
        baseDir: root,
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
          exitCode: options.compareExit ?? 0,
          signal: '',
          ok: (options.compareExit ?? 0) === 0,
        },
        attestation: {
          command: 'node scripts/generate-integrity-attestation.js ...',
          exitCode: options.attestationExit ?? 0,
          signal: '',
          ok: (options.attestationExit ?? 0) === 0,
        },
        status: options.status ?? 'ok',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return dir
}

function runIndex(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('index-evidence-bundles.js', () => {
  it('prints json index and writes it to --out', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-index-json-'))
    tempDirs.push(root)
    const older = writeBundle(root, '2026-04-10T10-20-30Z-111111-aaaaaa')
    const newer = writeBundle(root, '2026-04-10T10-20-31Z-222222-bbbbbb', {
      status: 'warning',
      compareExit: 2,
      attestationExit: 0,
    })
    const outFile = join(root, 'index.json')

    const res = runIndex(['--root', root, '--out', outFile])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.root).toBe(root)
    expect(parsed.format).toBe('json')
    expect(parsed.bundleCount).toBe(2)
    expect(parsed.bundles).toHaveLength(2)
    expect(parsed.bundles[0].dir).toBe(older)
    expect(parsed.bundles[0].timestamp).toBe('2026-04-10T10:20:30Z')
    expect(parsed.bundles[0].status).toBe('ok')
    expect(parsed.bundles[0].urlCount).toBe(2)
    expect(parsed.bundles[0].digest).toMatch(/^sha256:/)
    expect(parsed.bundles[1].dir).toBe(newer)
    expect(parsed.bundles[1].status).toBe('warning')
    expect(parsed.bundles[1].compareExit).toBe(2)
    expect(readFileSync(outFile, 'utf8')).toBe(res.stdout)
  })

  it('prints csv index in the requested column order', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-index-csv-'))
    tempDirs.push(root)
    const dir = writeBundle(root, '2026-04-10T10-20-30Z-111111-aaaaaa')

    const res = runIndex(['--root', root, '--format', 'csv'])
    expect(res.status).toBe(0)
    const lines = res.stdout.trimEnd().split('\n')
    expect(lines[0]).toBe('dir,timestamp,status,urlCount,digest,compareExit,attestationExit')
    expect(lines).toHaveLength(2)
    const row = lines[1].split(',')
    expect(row[0]).toBe(dir)
    expect(row[1]).toBe('2026-04-10T10:20:30Z')
    expect(row[2]).toBe('ok')
    expect(row[3]).toBe('2')
    expect(row[4]).toMatch(/^sha256:/)
    expect(row[5]).toBe('0')
    expect(row[6]).toBe('0')
  })

  it('fails in strict mode when a required file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-index-missing-'))
    tempDirs.push(root)
    const dir = join(root, '2026-04-10T10-20-30Z-111111-aaaaaa')
    writeBundle(root, '2026-04-10T10-20-30Z-111111-aaaaaa')
    rmSync(join(dir, 'compare.txt'))

    const res = runIndex(['--root', root, '--strict'])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('missing required file(s): compare.txt')
  })

  it('fails in strict mode when attestation JSON is malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-index-malformed-'))
    tempDirs.push(root)
    const dir = writeBundle(root, '2026-04-10T10-20-30Z-111111-aaaaaa')
    writeFileSync(join(dir, 'attestation.json'), '{not-json}\n', 'utf8')

    const res = runIndex(['--root', root, '--strict'])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('malformed JSON in')
    expect(res.stderr).toContain('attestation.json')
  })
})
