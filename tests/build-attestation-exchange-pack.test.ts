import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/build-attestation-exchange-pack.js', import.meta.url))
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
    if (typeof entry !== 'undefined') out[key] = canonicalize(entry)
  }
  return out
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function digestForAttestation(attestation: Record<string, unknown>): string {
  const copy = { ...attestation }
  delete copy.digest
  return `sha256:${createHash('sha256').update(canonicalJson(copy)).digest('hex')}`
}

function buildAttestation(overrides: Record<string, unknown> = {}) {
  const attestation: Record<string, unknown> = {
    artifactType: 'gateway-integrity-attestation',
    scriptVersionTag: 'integrity-attestation-v1',
    generatedAt: '2026-04-10T12:34:56.000Z',
    gateways: [
      {
        label: '#1 gw-a.example',
        url: 'https://gw-a.example/integrity/state',
        snapshot: { release: { root: 'root-a' } },
      },
      {
        label: '#2 gw-b.example',
        url: 'https://gw-b.example/integrity/state',
        snapshot: { release: { root: 'root-a' } },
      },
    ],
    comparedFields: [
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

  return { ...attestation, digest: digestForAttestation(attestation) }
}

function writeBundle(root: string, name: string, options: { attestation?: Record<string, unknown>; manifest?: Record<string, unknown>; compare?: string } = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const attestation = options.attestation ?? buildAttestation()
  const manifest = options.manifest ?? {
    tool: 'scripts/export-integrity-evidence.js',
    version: 1,
    startedAt: '2026-04-10T12:30:00.000Z',
    finishedAt: '2026-04-10T12:31:00.000Z',
    status: 'ok',
    urls: ['https://gw-a.example', 'https://gw-b.example'],
    compare: { exitCode: 0, ok: true },
    attestation: { exitCode: 0, ok: true, digest: attestation.digest },
  }

  writeFileSync(join(dir, 'compare.txt'), options.compare ?? 'compare ok\nsummary: consensus\n', 'utf8')
  writeFileSync(join(dir, 'attestation.json'), `${JSON.stringify(attestation, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return dir
}

function runPack(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
}

describe('build-attestation-exchange-pack.js', () => {
  it('builds a compact exchange pack with compare snippets', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-exchange-pack-'))
    tempDirs.push(root)
    const bundleA = writeBundle(root, '2026-04-10T12-30-00Z-111111-aaaaaa')
    const bundleB = writeBundle(root, '2026-04-10T12-31-00Z-222222-bbbbbb')
    const outDir = join(root, 'out')
    const outFile = join(outDir, 'exchange-pack.json')

    const res = runPack(['--bundle', bundleA, '--bundle', bundleB, '--out', outFile, '--include-compare-log'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain(outFile)

    const parsed = JSON.parse(readFileSync(outFile, 'utf8')) as Record<string, unknown>
    expect(typeof parsed.createdAt).toBe('string')
    expect(new Date(parsed.createdAt as string).toISOString()).toBe(parsed.createdAt)
    expect(parsed.summary).toMatchObject({
      total: 2,
      ok: 2,
      failed: 0,
      mismatchedDigest: 0,
    })

    const bundles = parsed.bundles as Array<Record<string, unknown>>
    expect(bundles).toHaveLength(2)
    expect(bundles[0]).toMatchObject({
      bundleDir: bundleA,
      comparePath: join(bundleA, 'compare.txt'),
      attestationPath: join(bundleA, 'attestation.json'),
      manifestPath: join(bundleA, 'manifest.json'),
      attestationDigest: (buildAttestation() as Record<string, unknown>).digest,
      manifestMetadata: {
        status: 'ok',
        tool: 'scripts/export-integrity-evidence.js',
      },
    })
    expect(bundles[0].compareSummarySnippet as string).toContain('compare ok')
    expect(bundles[1].compareSummarySnippet as string).toContain('compare ok')
  })

  it('fails when a required bundle file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-exchange-pack-missing-'))
    tempDirs.push(root)
    const bundle = join(root, '2026-04-10T12-30-00Z-111111-aaaaaa')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'compare.txt'), 'compare ok\n', 'utf8')
    writeFileSync(join(bundle, 'manifest.json'), '{}\n', 'utf8')

    const outFile = join(root, 'out', 'pack.json')
    const res = runPack(['--bundle', bundle, '--out', outFile])

    expect(res.status).toBe(3)
    expect(res.stderr).toContain('missing required file(s)')
    expect(res.stderr).toContain('attestation.json')
  })

  it('fails on malformed JSON in a bundle manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-exchange-pack-json-'))
    tempDirs.push(root)
    const bundle = join(root, '2026-04-10T12-30-00Z-111111-aaaaaa')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'compare.txt'), 'compare ok\n', 'utf8')
    writeFileSync(join(bundle, 'attestation.json'), `${JSON.stringify(buildAttestation(), null, 2)}\n`, 'utf8')
    writeFileSync(join(bundle, 'manifest.json'), '{ not valid json }\n', 'utf8')

    const outFile = join(root, 'out', 'pack.json')
    const res = runPack(['--bundle', bundle, '--out', outFile])

    expect(res.status).toBe(3)
    expect(res.stderr).toContain('malformed JSON in')
    expect(res.stderr).toContain('manifest.json')
  })
})
