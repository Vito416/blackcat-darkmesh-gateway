import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { runCli, runReleaseDrill } from '../scripts/run-release-drill.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'release-drill-'))
  tempDirs.push(dir)
  return dir
}

function makeSpawnResult(stdout: string, stderr = '', status = 0) {
  return {
    status,
    stdout,
    stderr,
    error: null,
    signal: null,
  }
}

describe('run-release-drill.js', () => {
  it('prints help text', () => {
    const result = runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('node scripts/run-release-drill.js')
    expect(result.stdout).toContain('Sequence:')
    expect(result.stderr).toBe('')
  })

  it('prints a dry-run plan without executing child steps', () => {
    const result = runCli([
      '--urls',
      'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
      '--out-dir',
      './tmp/release-drill',
      '--profile',
      'diskless',
      '--mode',
      'all',
      '--allow-anon',
      '--release',
      '2.0.0',
      '--strict',
      '--dry-run',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Dry run: release drill')
    expect(result.stdout).toContain('1) validate consistency preflight')
    expect(result.stdout).toContain('scripts/compare-integrity-matrix.js')
    expect(result.stdout).toContain('scripts/export-integrity-evidence.js')
    expect(result.stdout).toContain('scripts/latest-evidence-bundle.js')
    expect(result.stdout).toContain('scripts/check-evidence-bundle.js')
    expect(result.stdout).toContain('release-evidence-pack.json')
    expect(result.stdout).toContain('release-readiness.json')
    expect(result.stdout).toContain('scripts/build-release-drill-manifest.js')
    expect(result.stdout).toContain('scripts/validate-release-drill-manifest.js')
    expect(result.stdout).toContain('scripts/check-release-drill-artifacts.js')
    expect(result.stdout).toContain('Strict readiness: yes')
    expect(result.stderr).toBe('')
  })

  it('returns a usage error when required arguments are missing', () => {
    const result = runCli(['--out-dir', './tmp/release-drill'])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: --urls is required')
  })

  it('orchestrates the release drill through injected child-process results', () => {
    const outDir = makeTempDir()
    const spawnSyncFn = vi.fn((command: string, args: string[]) => {
      const scriptPath = String(args[0] ?? '')
      const scriptName = scriptPath.split('/').pop() ?? scriptPath.split('\\').pop() ?? ''

      if (scriptName === 'validate-consistency-preflight.js') {
        return makeSpawnResult(
          [
            'Consistency preflight passed',
            'URLs: 2',
            'Mode: pairwise',
            'Profile: wedos_medium',
            'Auth: token provided',
          ].join('\n'),
        )
      }

      if (scriptName === 'compare-integrity-matrix.js') {
        return makeSpawnResult(
          JSON.stringify({
            exitCode: 0,
            counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
            runs: [{ index: 1, status: 'PASS' }],
          }, null, 2),
        )
      }

      if (scriptName === 'export-consistency-report.js') {
        const reportPath = join(outDir, 'consistency-drift-report.md')
        const summaryPath = join(outDir, 'consistency-drift-summary.json')
        writeFileSync(reportPath, '# Multi-region drift report\n', 'utf8')
        writeFileSync(
          summaryPath,
          JSON.stringify({ profile: 'wedos_medium', status: 'ok', counts: { total: 1 } }, null, 2),
          'utf8',
        )
        return makeSpawnResult(
          [
            `[export-consistency-report] wrote drift report to ${reportPath}`,
            `[export-consistency-report] wrote drift summary to ${summaryPath}`,
          ].join('\n'),
        )
      }

      if (scriptName === 'export-integrity-evidence.js') {
        const evidenceRoot = join(outDir, 'evidence')
        const bundleDir = join(evidenceRoot, '2026-04-11T12-00-00Z-abc')
        mkdirSync(bundleDir, { recursive: true })
        writeFileSync(join(bundleDir, 'compare.txt'), 'comparison ok\n', 'utf8')
        writeFileSync(join(bundleDir, 'attestation.json'), '{"ok":true}\n', 'utf8')
        writeFileSync(join(bundleDir, 'manifest.json'), '{"ok":true}\n', 'utf8')
        return makeSpawnResult('evidence bundle exported\n')
      }

      if (scriptName === 'latest-evidence-bundle.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              bundleDir: join(outDir, 'evidence', '2026-04-11T12-00-00Z-abc'),
              bundleName: '2026-04-11T12-00-00Z-abc',
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'check-evidence-bundle.js') {
        return makeSpawnResult('valid evidence bundle (strict)\n')
      }

      if (scriptName === 'validate-ao-dependency-gate.js') {
        return makeSpawnResult(`valid dependency gate: ${args[2]}`)
      }

      if (scriptName === 'build-release-evidence-pack.js') {
        const packMd = join(outDir, 'release-evidence-pack.md')
        const packJson = join(outDir, 'release-evidence-pack.json')
        const pack = {
          createdAt: '2026-04-11T12:00:00.000Z',
          release: '2.0.0',
          status: 'ready',
          blockers: [],
          warnings: [],
          consistency: { present: true, status: 'pass', reason: 'all runs matched' },
          evidence: { present: true, status: 'pass', reason: 'latest bundle strict markers are ok' },
          aoGate: { present: true, status: 'pass', reason: 'all required AO dependency checks are closed' },
        }
        writeFileSync(packMd, '# Release Evidence Pack\n', 'utf8')
        writeFileSync(packJson, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
        return makeSpawnResult('# Release Evidence Pack\n')
      }

      if (scriptName === 'build-release-signoff-checklist.js') {
        const checklistPath = join(outDir, 'release-signoff-checklist.md')
        writeFileSync(checklistPath, '# Release Sign-off Checklist\n', 'utf8')
        return makeSpawnResult('# Release Sign-off Checklist\n')
      }

      if (scriptName === 'check-release-readiness.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              status: 'ready',
              blockerCount: 0,
              warningCount: 0,
              release: '2.0.0',
            },
            null,
            2,
          ),
        )
      }

      if (scriptName === 'build-release-drill-manifest.js') {
        const manifestPath = join(outDir, 'release-drill-manifest.json')
        writeFileSync(
          manifestPath,
          `${JSON.stringify(
            {
              release: '2.0.0',
              status: 'ready',
              artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 123, sha256: 'a'.repeat(64) }],
            },
            null,
            2,
          )}\n`,
          'utf8',
        )
        return makeSpawnResult(`# Release Drill Manifest\n- Output: ${manifestPath}\n`)
      }

      if (scriptName === 'validate-release-drill-manifest.js') {
        return makeSpawnResult('valid release drill manifest: /tmp/release-drill-manifest.json\n')
      }

      if (scriptName === 'check-release-drill-artifacts.js') {
        return makeSpawnResult(
          JSON.stringify(
            {
              ok: true,
              requiredCount: 10,
              presentCount: 10,
              missing: [],
              issues: [],
            },
            null,
            2,
          ),
        )
      }

      return makeSpawnResult('', `unexpected script: ${scriptName}`, 3)
    })

    const result = runReleaseDrill(
      {
        urlsCsv: 'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
        outDir,
        profile: 'wedos_medium',
        mode: 'pairwise',
        token: 'shared-token',
        allowAnon: false,
        release: '2.0.0',
        strict: true,
      },
      { spawnSyncFn },
    )

    expect(result.exitCode).toBe(0)
    expect(spawnSyncFn).toHaveBeenCalledTimes(13)
    expect(spawnSyncFn.mock.calls.map((call) => basename(String(call[1][0])))).toEqual([
      'validate-consistency-preflight.js',
      'compare-integrity-matrix.js',
      'export-consistency-report.js',
      'export-integrity-evidence.js',
      'latest-evidence-bundle.js',
      'check-evidence-bundle.js',
      'validate-ao-dependency-gate.js',
      'build-release-evidence-pack.js',
      'build-release-signoff-checklist.js',
      'check-release-readiness.js',
      'build-release-drill-manifest.js',
      'validate-release-drill-manifest.js',
      'check-release-drill-artifacts.js',
    ])
    expect(result.stdout).toContain('[1/13] validate consistency preflight')
    expect(result.stdout).toContain('# Release Evidence Pack')
    expect(result.stdout).toContain('# Release Sign-off Checklist')
    expect(result.stdout).toContain('"status": "ready"')
    expect(result.stderr).toBe('')

    const matrix = JSON.parse(readFileSync(join(outDir, 'consistency-matrix.json'), 'utf8'))
    const pack = JSON.parse(readFileSync(join(outDir, 'release-evidence-pack.json'), 'utf8'))
    const latest = JSON.parse(readFileSync(join(outDir, 'latest-evidence-bundle.json'), 'utf8'))
    const readiness = JSON.parse(readFileSync(join(outDir, 'release-readiness.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(outDir, 'release-drill-manifest.json'), 'utf8'))
    const manifestValidation = readFileSync(join(outDir, 'release-drill-manifest.validation.txt'), 'utf8')
    const drillCheck = JSON.parse(readFileSync(join(outDir, 'release-drill-check.json'), 'utf8'))
    expect(matrix.counts.total).toBe(1)
    expect(pack.status).toBe('ready')
    expect(latest.bundleName).toBe('2026-04-11T12-00-00Z-abc')
    expect(readiness.status).toBe('ready')
    expect(manifest.release).toBe('2.0.0')
    expect(manifestValidation).toContain('valid release drill manifest')
    expect(drillCheck.ok).toBe(true)
  })
})
