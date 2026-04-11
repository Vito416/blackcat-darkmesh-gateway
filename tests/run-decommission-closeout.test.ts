import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { runCli } from '../scripts/run-decommission-closeout.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'decommission-closeout-'))
  tempDirs.push(dir)
  return dir
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function seedCloseoutArtifacts(dir: string) {
  mkdirSync(join(dir, 'evidence'), { recursive: true })
  writeJson(join(dir, 'consistency-matrix.json'), { counts: { total: 1, pass: 1, mismatch: 0, failure: 0 } })
  writeFileSync(join(dir, 'consistency-drift-report.md'), '# Drift report\n', 'utf8')
  writeJson(join(dir, 'consistency-drift-summary.json'), { status: 'ok', counts: { total: 1 } })
  writeJson(join(dir, 'latest-evidence-bundle.json'), {
    bundleName: '2026-04-11T12-00-00Z-abc',
    bundleDir: join(dir, 'evidence', '2026-04-11T12-00-00Z-abc'),
  })
  writeFileSync(join(dir, 'ao-dependency-gate.validation.txt'), 'valid dependency gate\n', 'utf8')
  writeFileSync(join(dir, 'release-evidence-pack.md'), '# Release Evidence Pack\n', 'utf8')
  writeJson(join(dir, 'release-evidence-pack.json'), { release: '1.4.0', status: 'ready' })
  writeFileSync(join(dir, 'release-signoff-checklist.md'), '# Release Sign-off Checklist\n', 'utf8')
  writeJson(join(dir, 'release-readiness.json'), { release: '1.4.0', status: 'ready', blockerCount: 0, warningCount: 0 })
  writeJson(join(dir, 'release-drill-manifest.json'), {
    release: '1.4.0',
    status: 'ready',
    artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 120, sha256: 'a'.repeat(64) }],
  })
  writeFileSync(join(dir, 'release-drill-manifest.validation.txt'), 'valid release drill manifest\n', 'utf8')
  writeJson(join(dir, 'release-drill-check.json'), { ok: true, requiredCount: 5, presentCount: 5, missing: [], issues: [] })
  writeFileSync(join(dir, 'release-evidence-ledger.md'), '# Release Evidence Ledger\n', 'utf8')
  writeJson(join(dir, 'release-evidence-ledger.json'), {
    release: '1.4.0',
    overallStatus: 'ready',
    checks: {
      packReady: true,
      readinessReady: true,
      drillCheckOk: true,
      manifestValidated: true,
      aoGateValidated: true,
    },
  })
  writeJson(join(dir, 'ao-dependency-gate.json'), {
    schemaVersion: 1,
    release: '1.4.0',
    updatedAt: '2026-04-11T13:35:00Z',
    required: ['p0_1_registry_contract_surface', 'p1_1_authority_rotation_workflow', 'p1_2_audit_commitments_stream'],
    checks: [
      {
        id: 'p0_1_registry_contract_surface',
        title: 'P0.1 AO integrity registry contract surface',
        status: 'closed',
        evidence: 'release-drill/evidence/p0_1.md',
      },
      {
        id: 'p1_1_authority_rotation_workflow',
        title: 'P1.1 Authority separation and rotation workflow',
        status: 'closed',
        evidence: 'release-drill/evidence/p1_1.md',
      },
      {
        id: 'p1_2_audit_commitments_stream',
        title: 'P1.2 Audit commitments stream',
        status: 'closed',
        evidence: 'release-drill/evidence/p1_2.md',
      },
    ],
  })
}

function spawnResult(stdout: string, stderr = '', status = 0) {
  return {
    status,
    stdout,
    stderr,
    error: null,
    signal: null,
  }
}

function scriptName(args: string[]) {
  const scriptPath = String(args[0] ?? '')
  return basename(scriptPath)
}

describe('run-decommission-closeout.js', () => {
  it('prints help text', () => {
    const result = runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('node scripts/run-decommission-closeout.js')
    expect(result.stdout).toContain('Sequence:')
    expect(result.stdout).toContain('--json')
    expect(result.stderr).toBe('')
  })

  it('prints a dry-run plan and does not spawn child steps', () => {
    const result = runCli([
      '--dir',
      './tmp/closeout',
      '--ao-gate',
      './tmp/ao-dependency-gate.json',
      '--profile',
      'wedos_medium',
      '--env-file',
      './tmp/wedos.env',
      '--dry-run',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# Decommission Closeout')
    expect(result.stdout).toContain('check AO gate evidence')
    expect(result.stdout).toContain('validate WEDOS readiness (wedos_medium)')
    expect(result.stdout).toContain('build decommission evidence log')
    expect(result.stdout).toContain('decommission-evidence-log.json')
    expect(result.stderr).toBe('')
  })

  it('runs the closeout flow and returns machine-friendly JSON', () => {
    const dir = makeTempDir()
    seedCloseoutArtifacts(dir)
    const envFile = join(dir, 'wedos.env')
    writeFileSync(envFile, 'GATEWAY_RESOURCE_PROFILE=wedos_small\n', 'utf8')

    const spawnSyncFn = vi.fn((command: string, args: string[]) => {
      expect(command).toBe(process.execPath)

      switch (scriptName(args)) {
        case 'check-ao-gate-evidence.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'ao-dependency-gate.json'),
                result: 'OK',
                closeoutReady: true,
                warnings: [],
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'check-decommission-readiness.js':
          return spawnResult(
            JSON.stringify(
              {
                status: 'ready',
                blockerCount: 0,
                blockers: [],
                checks: {
                  releaseEvidencePack: { status: 'ready' },
                  releaseReadiness: { status: 'ready' },
                  releaseDrillManifest: { status: 'ready' },
                  releaseDrillCheck: { ok: true },
                  releaseEvidenceLedger: { status: 'ready' },
                  aoGate: { closedCount: 3, openCount: 0 },
                },
              },
              null,
              2,
            ),
          )
        case 'validate-wedos-readiness.js':
          return spawnResult(
            JSON.stringify(
              {
                profile: 'wedos_small',
                status: 'pass',
                criticalCount: 0,
                warningCount: 0,
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'build-decommission-evidence-log.js': {
          const logMd = join(dir, 'decommission-evidence-log.md')
          const logJson = join(dir, 'decommission-evidence-log.json')
          writeFileSync(logMd, '# Decommission Evidence Log\n', 'utf8')
          writeJson(logJson, {
            createdAtUtc: '2026-04-11T12:00:00.000Z',
            status: 'complete',
            release: '1.4.0',
            presence: { complete: true, requiredCount: 12, requiredPresentCount: 12, requiredMissingCount: 0 },
          })
          return spawnResult('# Decommission Evidence Log\n')
        }
        default:
          throw new Error(`unexpected script: ${scriptName(args)}`)
      }
    })

    const result = runCli(
      [
        '--dir',
        dir,
        '--ao-gate',
        join(dir, 'ao-dependency-gate.json'),
        '--profile',
        'wedos_small',
        '--env-file',
        envFile,
        '--operator',
        'ops-user',
        '--ticket',
        'GW-1234',
        '--decision',
        'go',
        '--notes',
        'final closeout',
        '--recovery-drill-link',
        'https://example.com/recovery',
        '--ao-fallback-link',
        'https://example.com/fallback',
        '--rollback-proof-link',
        'https://example.com/rollback',
        '--approvals-link',
        'https://example.com/approvals',
        '--json',
      ],
      { spawnSyncFn },
    )

    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('ready')
    expect(payload.exitCode).toBe(0)
    expect(payload.steps).toHaveLength(4)
    expect(payload.steps.map((step: { status: string }) => step.status)).toEqual(['passed', 'passed', 'passed', 'passed'])
    expect(payload.steps[3].log.status).toBe('complete')
    expect(payload.artifacts.decommissionEvidenceLogJson).toContain('decommission-evidence-log.json')
    expect(spawnSyncFn).toHaveBeenCalledTimes(4)
    expect(spawnSyncFn.mock.calls.map((call) => basename(String(call[1][0])))).toEqual([
      'check-ao-gate-evidence.js',
      'check-decommission-readiness.js',
      'validate-wedos-readiness.js',
      'build-decommission-evidence-log.js',
    ])
  })

  it('keeps going to the evidence log in strict mode and then fails the closeout', () => {
    const dir = makeTempDir()
    seedCloseoutArtifacts(dir)

    const spawnSyncFn = vi.fn((command: string, args: string[]) => {
      expect(command).toBe(process.execPath)

      switch (scriptName(args)) {
        case 'check-ao-gate-evidence.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'ao-dependency-gate.json'),
                result: 'OK',
                closeoutReady: true,
                warnings: [],
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'check-decommission-readiness.js':
          return spawnResult(
            JSON.stringify(
              {
                status: 'blocked',
                blockerCount: 1,
                blockers: ['release-readiness.json status is warning (expected ready)'],
                checks: {},
              },
              null,
              2,
            ),
            '',
            3,
          )
        case 'build-decommission-evidence-log.js': {
          const logMd = join(dir, 'decommission-evidence-log.md')
          const logJson = join(dir, 'decommission-evidence-log.json')
          writeFileSync(logMd, '# Decommission Evidence Log\n', 'utf8')
          writeJson(logJson, {
            createdAtUtc: '2026-04-11T12:00:00.000Z',
            status: 'complete',
            release: '1.4.0',
            presence: { complete: true, requiredCount: 12, requiredPresentCount: 12, requiredMissingCount: 0 },
          })
          return spawnResult('# Decommission Evidence Log\n')
        }
        default:
          throw new Error(`unexpected script: ${scriptName(args)}`)
      }
    })

    const result = runCli(
      [
        '--dir',
        dir,
        '--ao-gate',
        join(dir, 'ao-dependency-gate.json'),
        '--operator',
        'ops-user',
        '--decision',
        'pending',
        '--strict',
        '--json',
      ],
      { spawnSyncFn },
    )

    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.exitCode).toBe(3)
    expect(payload.steps.map((step: { status: string }) => step.status)).toEqual(['passed', 'blocked', 'skipped', 'passed'])
    expect(payload.blockers.some((blocker: string) => blocker.includes('decommission readiness has blockers'))).toBe(true)
    expect(spawnSyncFn.mock.calls.map((call) => basename(String(call[1][0])))).toEqual([
      'check-ao-gate-evidence.js',
      'check-decommission-readiness.js',
      'build-decommission-evidence-log.js',
    ])
  })
})
