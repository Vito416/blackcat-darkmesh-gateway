import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { REQUIRED_ARTIFACTS } from '../scripts/build-release-drill-manifest.js'

const scriptPath = fileURLToPath(new URL('../scripts/build-release-drill-manifest.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function runManifest(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

function seedDrill(options: { omit?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-drill-'))
  tempDirs.push(dir)
  const omit = new Set(options.omit ?? [])

  const files: Record<string, string> = {
    'consistency-matrix.json': JSON.stringify({ counts: { total: 1, pass: 1, mismatch: 0, failure: 0 } }),
    'consistency-drift-report.md': '# Drift report\n',
    'consistency-drift-summary.json': JSON.stringify({ status: 'ok', counts: { total: 1 } }),
    'latest-evidence-bundle.json': JSON.stringify({
      bundleDir: join(dir, 'evidence', '2026-04-11T12-00-00Z-abc'),
      bundleName: '2026-04-11T12-00-00Z-abc',
    }),
    'ao-dependency-gate.validation.txt': 'valid dependency gate: ./ops/decommission/ao-dependency-gate.json\n',
    'release-evidence-pack.md': '# Release Evidence Pack\n',
    'release-evidence-pack.json': JSON.stringify({
      release: '1.4.0',
      status: 'not-ready',
      blockers: ['consistency status=fail: 1 failure run(s)'],
      warnings: [],
    }),
    'release-signoff-checklist.md': '# Release Sign-off Checklist\n',
    'release-readiness.json': JSON.stringify({
      release: '1.4.0',
      status: 'ready',
      blockerCount: 0,
      warningCount: 0,
    }),
    'legacy-core-extraction-evidence.json': JSON.stringify({ ok: true, status: 'pass' }),
    'legacy-crypto-boundary-evidence.json': JSON.stringify({ ok: true, status: 'pass' }),
    'template-variant-map.json': JSON.stringify({
      ok: true,
      status: 'complete',
      strict: true,
      providedSites: ['site-alpha'],
      requiredSites: ['site-alpha'],
      missingSites: [],
      issues: [],
      warnings: [],
      map: {
        'site-alpha': {
          variant: 'signal',
          templateTxId: 'tx-alpha',
          manifestTxId: 'manifest-alpha',
        },
      },
    }),
    'release-drill-checks.json': JSON.stringify({
      release: '1.4.0',
      profile: 'wedos_medium',
      mode: 'pairwise',
      strict: false,
    }),
  }

  for (const [name, content] of Object.entries(files)) {
    if (omit.has(name)) continue
    writeFileSync(join(dir, name), `${content}\n`, 'utf8')
  }

  return dir
}

describe('build-release-drill-manifest.js', () => {
  it('builds the manifest, writes the default file, and prefers readiness status', () => {
    const dir = seedDrill()
    const res = runManifest(['--dir', dir, '--json'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')

    const parsed = JSON.parse(res.stdout)
    expect(parsed.drillDir).toBe(dir)
    expect(parsed.release).toBe('1.4.0')
    expect(parsed.status).toBe('ready')
    expect(parsed.artifacts).toHaveLength(REQUIRED_ARTIFACTS.length)
    expect(parsed.artifacts.map((entry: { path: string }) => entry.path)).toEqual(REQUIRED_ARTIFACTS)
    expect(Number.isNaN(Date.parse(parsed.createdAt))).toBe(false)

    const matrixContent = `${JSON.stringify({ counts: { total: 1, pass: 1, mismatch: 0, failure: 0 } })}\n`
    const expectedHash = createHash('sha256').update(matrixContent).digest('hex')
    expect(parsed.artifacts[0]).toEqual({
      path: 'consistency-matrix.json',
      sizeBytes: Buffer.byteLength(matrixContent),
      sha256: expectedHash,
    })

    const outPath = join(dir, 'release-drill-manifest.json')
    expect(readFileSync(outPath, 'utf8')).toBe(res.stdout)
  })

  it('fails with exit code 3 when a required artifact is missing', () => {
    const dir = seedDrill({ omit: ['release-signoff-checklist.md'] })
    const res = runManifest(['--dir', dir])

    expect(res.status).toBe(3)
    expect(res.stdout).toBe('')
    expect(res.stderr).toContain('missing required artifact(s): release-signoff-checklist.md')
  })

  it('prints help and treats missing --dir as a usage error', () => {
    const helpRes = runManifest(['--help'])
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('Usage:')
    expect(helpRes.stdout).toContain('--dir <DRILL_DIR>')

    const missingRes = runManifest([])
    expect(missingRes.status).toBe(64)
    expect(missingRes.stderr).toContain('error: --dir is required')
  })
})
