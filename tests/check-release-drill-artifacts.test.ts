import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REQUIRED_FILES, runCli } from '../scripts/check-release-drill-artifacts.js'
import { REQUIRED_ARTIFACTS as REQUIRED_MANIFEST_ARTIFACTS } from '../scripts/build-release-drill-manifest.js'

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
  const legacyCoreExtractionEvidence = { ok: true, status: 'pass' }
  const legacyCryptoBoundaryEvidence = { ok: true, status: 'pass' }
  const templateWorkerMapCoherence = {
    ok: true,
    status: 'complete',
    strict: false,
    counts: {
      issueCount: 0,
      warningCount: 0,
    },
    issues: [],
    warnings: [],
  }
  const forgetForwardConfig = {
    ok: false,
    status: 'pending',
    strict: false,
    counts: {
      issueCount: 0,
      warningCount: 1,
    },
    issues: [],
    warnings: ['forget-forward relay is disabled because the URL is not set'],
  }
  const templateSignatureRefMap = {
    ok: true,
    status: 'complete',
    strict: false,
    requiredSites: [],
    providedSites: [],
    missingSites: [],
    counts: {
      providedCount: 0,
      requiredCount: 0,
      missingCount: 0,
      emptyValueCount: 0,
    },
    issues: [],
    warnings: [],
    map: {},
  }
  const templateVariantMap = {
    ok: true,
    status: 'complete',
    strict: true,
    requiredSites: [],
    providedSites: ['site-alpha'],
    missingSites: [],
    counts: {
      providedCount: 1,
      requiredCount: 0,
      missingCount: 0,
    },
    issues: [],
    warnings: [],
    map: {
      'site-alpha': {
        variant: 'signal',
        templateTxId: 'tx-alpha',
        manifestTxId: 'manifest-alpha',
      },
    },
  }
  const manifestArtifacts = REQUIRED_MANIFEST_ARTIFACTS.map((path, index) => ({
    path,
    sizeBytes: 100 + index,
    sha256: `${index.toString(16).padStart(2, '0')}`.repeat(32),
  }))

  const payloads: Record<string, string> = {
    'consistency-matrix.json': JSON.stringify({ counts: { total: 1, pass: 1, mismatch: 0, failure: 0 } }),
    'consistency-drift-report.md': '# Drift report\n',
    'consistency-drift-summary.json': JSON.stringify({ status: 'ok', counts: { total: 1 } }),
    'latest-evidence-bundle.json': JSON.stringify({ bundleDir: join(dir, 'evidence', 'bundle-1'), bundleName: 'bundle-1' }),
    'ao-dependency-gate.validation.txt': 'valid dependency gate: ./ops/decommission/ao-dependency-gate.json\n',
    'release-evidence-pack.md': '# Release pack\n',
    'release-evidence-pack.json': JSON.stringify({ release, status: 'ready', blockers: [], warnings: [] }),
    'release-signoff-checklist.md': '# Checklist\n',
    'release-readiness.json': JSON.stringify({ release: readinessRelease, status: 'ready', blockerCount: 0, warningCount: 0 }),
    'legacy-core-extraction-evidence.json': JSON.stringify(legacyCoreExtractionEvidence),
    'legacy-crypto-boundary-evidence.json': JSON.stringify(legacyCryptoBoundaryEvidence),
    'template-worker-map-coherence.json': JSON.stringify(templateWorkerMapCoherence),
    'forget-forward-config.json': JSON.stringify(forgetForwardConfig),
    'template-signature-ref-map.json': JSON.stringify(templateSignatureRefMap),
    'template-variant-map.json': JSON.stringify(templateVariantMap),
    'release-drill-checks.json': JSON.stringify({
      release,
      profile: 'wedos_medium',
      mode: 'pairwise',
      strict: false,
      legacyCoreExtractionEvidence,
      legacyCryptoBoundaryEvidence,
      templateWorkerMapCoherence,
      forgetForwardConfig,
      templateSignatureRefMap,
      templateVariantMap,
    }),
    'release-drill-manifest.json': JSON.stringify({
      release: manifestRelease,
      status: 'ready',
      artifacts: manifestArtifacts,
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

  it('accepts legacy optional artifact names with warnings for compatibility', () => {
    const dir = seedDrillDir()
    const legacyRenames: Array<{ from: string; to: string }> = [
      { from: 'template-worker-map-coherence.json', to: 'check-template-worker-map-coherence.json' },
      { from: 'forget-forward-config.json', to: 'check-forget-forward-config.json' },
      { from: 'template-signature-ref-map.json', to: 'check-template-signature-ref-map.json' },
    ]

    for (const rename of legacyRenames) {
      const content = JSON.parse(readFileSync(join(dir, rename.from), 'utf8'))
      rmSync(join(dir, rename.from), { force: true })
      writeFileSync(join(dir, rename.to), `${JSON.stringify(content)}\n`, 'utf8')
    }

    const result = runCli(['--dir', dir, '--strict', '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.ok).toBe(true)
    expect(payload.missing).toEqual([])
    expect(payload.warnings).toHaveLength(3)
    expect(payload.strictChecks.aliasFallbackCount).toBe(3)
  })

  it('returns usage error when --dir is missing', () => {
    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: --dir is required')
  })
})
