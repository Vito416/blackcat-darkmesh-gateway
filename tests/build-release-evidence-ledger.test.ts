import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DECISIONS, LEDGER_FILES, buildLedger, parseArgs, runCli } from '../scripts/build-release-evidence-ledger.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'release-ledger-'))
  tempDirs.push(dir)
  return dir
}

async function seedDrillArtifacts(dir: string, overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    'consistency-matrix.json': JSON.stringify({ counts: { total: 1, pass: 1, mismatch: 0, failure: 0 } }),
    'consistency-drift-report.md': '# Drift report\n',
    'consistency-drift-summary.json': JSON.stringify({ status: 'ok', counts: { total: 1 } }),
    'latest-evidence-bundle.json': JSON.stringify({
      bundleName: '2026-04-11T12-00-00Z-abc',
      bundleDir: join(dir, 'evidence', '2026-04-11T12-00-00Z-abc'),
    }),
    'ao-dependency-gate.validation.txt': 'valid dependency gate: ./ops/decommission/ao-dependency-gate.json\n',
    'release-evidence-pack.md': '# Release Evidence Pack\n',
    'release-evidence-pack.json': JSON.stringify({ release: '1.4.0', status: 'ready' }),
    'release-signoff-checklist.md': '# Release Sign-off Checklist\n',
    'release-readiness.json': JSON.stringify({ release: '1.4.0', status: 'ready', blockerCount: 0, warningCount: 0 }),
    'legacy-core-extraction-evidence.json': JSON.stringify({ ok: true, status: 'pass' }),
    'legacy-crypto-boundary-evidence.json': JSON.stringify({ ok: true, status: 'pass' }),
    'release-drill-checks.json': JSON.stringify({
      release: '1.4.0',
      profile: 'wedos_medium',
      mode: 'pairwise',
      strict: false,
    }),
    'release-drill-manifest.json': JSON.stringify({
      release: '1.4.0',
      status: 'ready',
      artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 256, sha256: 'a'.repeat(64) }],
    }),
    'release-drill-manifest.validation.txt': 'valid release drill manifest: /tmp/release-drill-manifest.json\n',
    'release-drill-check.json': JSON.stringify({ ok: true, missing: [], issues: [] }),
  }

  for (const name of LEDGER_FILES) {
    const content = Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : defaults[name]
    await writeFile(join(dir, name), `${content}\n`, 'utf8')
  }
}

describe('build-release-evidence-ledger.js', () => {
  it('parses CLI args including decision enum and strict/json flags', () => {
    const parsed = parseArgs([
      '--dir',
      './tmp/release-drill',
      '--operator',
      'ops-user',
      '--decision',
      'go',
      '--run-url',
      'https://github.com/org/repo/actions/runs/123',
      '--artifact-base-url',
      'https://artifacts.example/release-drill/',
      '--commit',
      'abc123',
      '--out',
      './tmp/release-drill/ledger.md',
      '--json-out',
      './tmp/release-drill/ledger.json',
      '--json',
      '--strict',
    ])

    expect(DECISIONS.has(parsed.decision)).toBe(true)
    expect(parsed.strict).toBe(true)
    expect(parsed.json).toBe(true)
    expect(parsed.decision).toBe('go')
    expect(parsed.operator).toBe('ops-user')
  })

  it('builds a ready ledger from a complete drill artifact set', async () => {
    const dir = await makeTempDir()
    await seedDrillArtifacts(dir)

    const ledger = await buildLedger({ dir, operator: 'ops-user', decision: 'pending', runUrl: '', artifactBaseUrl: '', commit: '' })

    expect(ledger.release).toBe('1.4.0')
    expect(ledger.overallStatus).toBe('ready')
    expect(ledger.checks.packReady).toBe(true)
    expect(ledger.checks.readinessReady).toBe(true)
    expect(ledger.checks.drillCheckOk).toBe(true)
    expect(ledger.artifacts).toHaveLength(LEDGER_FILES.length)
  })

  it('writes markdown/json outputs and prints markdown by default', async () => {
    const dir = await makeTempDir()
    await seedDrillArtifacts(dir)

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runCli(['--dir', dir, '--operator', 'ops-user', '--decision', 'pending'])

    const markdown = await readFile(join(dir, 'release-evidence-ledger.md'), 'utf8')
    const json = JSON.parse(await readFile(join(dir, 'release-evidence-ledger.json'), 'utf8'))

    expect(markdown).toContain('# Release Evidence Ledger')
    expect(markdown).toContain('Overall status: `ready`')
    expect(json.operator).toBe('ops-user')
    expect(json.overallStatus).toBe('ready')
    expect(writeSpy).toHaveBeenCalled()
  })
})
