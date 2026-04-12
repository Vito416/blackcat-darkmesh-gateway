import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REQUIRED_FILES, runCli } from '../scripts/check-release-drill-artifacts.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'release-drill-check-'))
  tempDirs.push(dir)
  return dir
}

function seedDrillDir(options = {}) {
  const {
    omit = [],
    release = '1.4.0',
    readinessRelease = release,
    manifestRelease = release,
    includeValidManifestText = true,
  } = options as {
    omit?: string[]
    release?: string
    readinessRelease?: string
    manifestRelease?: string
    includeValidManifestText?: boolean
  }

  const dir = makeTempDir()
  const omitSet = new Set(omit)

  const payloads: Record<string, string> = {
    'consistency-matrix.json': JSON.stringify({ counts: { total: 1, pass: 1, mismatch: 0, failure: 0 } }),
    'consistency-drift-report.md': '# Drift report\n',
    'consistency-drift-summary.json': JSON.stringify({ status: 'ok', counts: { total: 1 } }),
    'latest-evidence-bundle.json': JSON.stringify({ bundleDir: join(dir, 'evidence', 'bundle-1'), bundleName: 'bundle-1' }),
    'ao-dependency-gate.validation.txt': 'valid dependency gate: ./kernel-migration/ao-dependency-gate.json\n',
    'release-evidence-pack.md': '# Release pack\n',
    'release-evidence-pack.json': JSON.stringify({ release, status: 'ready', blockers: [], warnings: [] }),
    'release-signoff-checklist.md': '# Checklist\n',
    'release-readiness.json': JSON.stringify({ release: readinessRelease, status: 'ready', blockerCount: 0, warningCount: 0 }),
    'release-drill-checks.json': JSON.stringify({
      release,
      profile: 'wedos_medium',
      mode: 'pairwise',
      strict: false,
    }),
    'release-drill-manifest.json': JSON.stringify({
      release: manifestRelease,
      status: 'ready',
      artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 120, sha256: 'a'.repeat(64) }],
    }),
    'release-drill-manifest.validation.txt': includeValidManifestText ? 'valid release drill manifest: /tmp/x\n' : 'manifest validation failed\n',
  }

  for (const [name, content] of Object.entries(payloads)) {
    if (omitSet.has(name)) continue
    writeFileSync(join(dir, name), `${content}\n`, 'utf8')
  }

  return dir
}

describe('check-release-drill-artifacts.js', () => {
  it('accepts a complete strict artifact set', () => {
    const dir = seedDrillDir()
    const result = runCli(['--dir', dir, '--strict', '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.ok).toBe(true)
    expect(payload.missing).toEqual([])
    expect(payload.issues).toEqual([])
    expect(payload.requiredCount).toBe(REQUIRED_FILES.length)
  })

  it('fails when a required file is missing', () => {
    const dir = seedDrillDir({ omit: ['release-drill-manifest.validation.txt'] })
    const result = runCli(['--dir', dir, '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.ok).toBe(false)
    expect(payload.missing).toContain('release-drill-manifest.validation.txt')
  })

  it('fails strict mode on cross-file release mismatch', () => {
    const dir = seedDrillDir({ manifestRelease: '1.4.1' })
    const result = runCli(['--dir', dir, '--strict', '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.ok).toBe(false)
    expect(payload.issues.some((issue: string) => issue.includes('release mismatch'))).toBe(true)
  })

  it('fails strict mode when AO gate validation output is malformed', () => {
    const dir = seedDrillDir()
    writeFileSync(join(dir, 'ao-dependency-gate.validation.txt'), 'gate failed\n', 'utf8')
    const result = runCli(['--dir', dir, '--strict', '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.ok).toBe(false)
    expect(payload.issues).toContain('ao-dependency-gate.validation.txt does not confirm valid dependency gate')
  })

  it('returns usage error when --dir is missing', () => {
    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: --dir is required')
  })
})
