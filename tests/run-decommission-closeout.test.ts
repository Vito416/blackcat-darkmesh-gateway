import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { parseArgs, runCli } from '../scripts/run-decommission-closeout.js'

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
  writeJson(join(dir, 'legacy-core-extraction-evidence.json'), { ok: true, status: 'pass' })
  writeJson(join(dir, 'legacy-crypto-boundary-evidence.json'), { ok: true, status: 'pass' })
  writeJson(join(dir, 'release-drill-checks.json'), {
    release: '1.4.0',
    profile: 'vps_medium',
    mode: 'pairwise',
    strict: false,
  })
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
  writeFileSync(
    join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
    `# Final Migration Summary

## Migration overview

- **Project:** \`blackcat-darkmesh-gateway\`
- **Legacy source:** \`blackcat-kernel-contracts\`
- **Target architecture:** \`AO + gateway + write\`
- **Summary date (UTC):** \`2026-04-11T12:00:00Z\`
- **Prepared by:** \`ops-user\`
- **Release / milestone:** \`1.4.0\`

## Scope completed

- **Included systems:**
  - \`gateway\`
- **Excluded systems:**
  - \`legacy\`
- **Key architecture changes:**
  - \`boundary validation\`
- **User-facing changes:**
  - \`closeout workflow\`

## Evidence pack

| Evidence item | UTC timestamp | Link | Notes |
| --- | --- | --- | --- |
| Final release drill | \`2026-04-11T12:00:00Z\` | \`https://example.com/release-drill\` | \`ok\` |
| Release evidence ledger | \`2026-04-11T12:00:00Z\` | \`https://example.com/ledger\` | \`ok\` |
| CI run / workflow | \`2026-04-11T12:00:00Z\` | \`https://example.com/ci\` | \`ok\` |
| Staging / production-like validation | \`2026-04-11T12:00:00Z\` | \`https://example.com/validation\` | \`ok\` |
| Manual operator proof | \`2026-04-11T12:00:00Z\` | \`https://example.com/manual\` | \`ok\` |

## Rollback reference

- **Rollback reference:** \`https://example.com/rollback\`
- **Rollback owner:** \`ops-user\`
- **Rollback command / procedure:** \`revert\`
- **Rollback evidence link:** \`https://example.com/rollback-proof\`
- **Rollback tested at (UTC):** \`2026-04-11T12:00:00Z\`

## Approvals

| Role | Name / handle | UTC approval time | Evidence reviewed | Decision |
| --- | --- | --- | --- | --- |
| Security | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/security\` | \`approved\` |
| Operations | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/operations\` | \`approved\` |
| Architecture | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/architecture\` | \`approved\` |
| Product / owner | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/product\` | \`approved\` |

## Residual risks

- **Residual risk:** \`none\`
- **Impact:** \`low\`
- **Likelihood:** \`low\`
- **Mitigation:** \`monitoring\`
- **Monitoring / alerting:** \`alerts\`
- **Expiry / revisit date (UTC):** \`2026-05-11T12:00:00Z\`

## Decommission decision

- **Decision:** \`GO\`
- **Decision time (UTC):** \`2026-04-11T12:00:00Z\`
- **Final status:** \`complete\`
- **Automation state:** \`complete\`
- **AO/manual state:** \`complete\`
- **Blockers remaining:** \`none\`
- **Archive / cleanup reference:** \`https://example.com/archive\`

## Operator notes

- \`closed\`
`,
    'utf8',
  )
  writeFileSync(
    join(dir, 'SIGNOFF_RECORD.md'),
    `# Signoff Record

## Record metadata

- **Record date (UTC):** \`2026-04-11T12:00:00Z\`
- **Prepared by:** \`ops-user\`
- **Repo:** \`blackcat-darkmesh-gateway\`
- **Related release / tag:** \`1.4.0\`
- **Related migration summary:** \`ops/decommission/FINAL_MIGRATION_SUMMARY.md\`
- **Related checklist:** \`ops/decommission/DECOMMISSION_CHECKLIST.md\`

## Decision

- **Decision:** \`GO\`
- **Decision rationale:** \`all checks passed\`
- **Decision time (UTC):** \`2026-04-11T12:00:00Z\`
- **Scope covered:** \`closeout\`
- **Scope excluded:** \`none\`

## Evidence reviewed

| Artifact | UTC timestamp | Link | Notes |
| --- | --- | --- | --- |
| Final migration summary | \`2026-04-11T12:00:00Z\` | \`https://example.com/summary\` | \`ok\` |
| Release evidence ledger | \`2026-04-11T12:00:00Z\` | \`https://example.com/ledger\` | \`ok\` |
| Release drill manifest | \`2026-04-11T12:00:00Z\` | \`https://example.com/manifest\` | \`ok\` |
| AO dependency gate validation | \`2026-04-11T12:00:00Z\` | \`https://example.com/gate\` | \`ok\` |
| CI / workflow run | \`2026-04-11T12:00:00Z\` | \`https://example.com/ci\` | \`ok\` |
| Rollback proof | \`2026-04-11T12:00:00Z\` | \`https://example.com/rollback\` | \`ok\` |

## Approvals

| Role | Name / handle | UTC approval time | Evidence reviewed | Approval |
| --- | --- | --- | --- | --- |
| Security | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/security\` | \`approved\` |
| Operations | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/operations\` | \`approved\` |
| Architecture | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/architecture\` | \`approved\` |
| Product / owner | \`ops-user\` | \`2026-04-11T12:00:00Z\` | \`https://example.com/product\` | \`approved\` |

## Rollback reference

- **Rollback document:** \`https://example.com/rollback-doc\`
- **Rollback owner:** \`ops-user\`
- **Rollback tested (UTC):** \`2026-04-11T12:00:00Z\`
- **Rollback evidence link:** \`https://example.com/rollback-proof\`

## Residual risks

- **Open risk:** \`none\`
- **Why it remains:** \`n/a\`
- **Mitigation in place:** \`monitoring\`
- **Follow-up owner:** \`ops-user\`
- **Review date (UTC):** \`2026-05-11T12:00:00Z\`

## Final notes

- \`immutable\`
`,
    'utf8',
  )
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
  it('parses summary and signoff paths', () => {
    const parsed = parseArgs([
      '--dir',
      './tmp/decommission-drill',
      '--ao-gate',
      './tmp/ao-dependency-gate.json',
      '--final-summary',
      './tmp/decommission-drill/FINAL_MIGRATION_SUMMARY.md',
      '--signoff-record',
      './tmp/decommission-drill/SIGNOFF_RECORD.md',
    ])

    expect(parsed.finalSummary).toContain('FINAL_MIGRATION_SUMMARY.md')
    expect(parsed.signoffRecord).toContain('SIGNOFF_RECORD.md')
  })

  it('prints help text', () => {
    const result = runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('node scripts/run-decommission-closeout.js')
    expect(result.stdout).toContain('Sequence:')
    expect(result.stdout).toContain('--final-summary <FILE>')
    expect(result.stdout).toContain('--signoff-record <FILE>')
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
      'vps_medium',
      '--env-file',
      './tmp/vps.env',
      '--dry-run',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# Decommission Closeout')
    expect(result.stdout).toContain('check AO gate evidence')
    expect(result.stdout).toContain('validate VPS readiness (vps_medium)')
    expect(result.stdout).toContain('validate final migration summary')
    expect(result.stdout).toContain('validate signoff record')
    expect(result.stdout).toContain('build decommission evidence log')
    expect(result.stdout).toContain('check decommission manual proofs')
    expect(result.stdout).toContain('decommission-evidence-log.json')
    expect(result.stderr).toBe('')
  })

  it('prints dry-run JSON with zero blocker counters', () => {
    const dir = makeTempDir()

    const result = runCli(
      [
        '--dir',
        dir,
        '--ao-gate',
        join(dir, 'ao-dependency-gate.json'),
        '--json',
        '--dry-run',
      ],
      { spawnSyncFn: vi.fn() },
    )

    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.dryRun).toBe(true)
    expect(payload.blockerCount).toBe(0)
    expect(payload.automationBlockerCount).toBe(0)
    expect(payload.aoManualBlockerCount).toBe(0)
    expect(payload.warningCount).toBe(0)
    expect(payload.steps).toHaveLength(7)
  })

  it('runs the closeout flow and returns machine-friendly JSON', () => {
    const dir = makeTempDir()
    seedCloseoutArtifacts(dir)
    const envFile = join(dir, 'vps.env')
    writeFileSync(envFile, 'GATEWAY_RESOURCE_PROFILE=vps_small\n', 'utf8')

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
        case 'validate-hosting-readiness.js':
          return spawnResult(
            JSON.stringify(
              {
                profile: 'vps_small',
                status: 'pass',
                criticalCount: 0,
                warningCount: 0,
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'validate-final-migration-summary.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
                ok: true,
                status: 'complete',
                issueCount: 0,
                strictIssueCount: 0,
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'validate-signoff-record.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'SIGNOFF_RECORD.md'),
                ok: true,
                status: 'complete',
                blockers: [],
                warnings: [],
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
            manualProofs: [
              { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' },
              { key: 'aoFallbackLink', label: 'AO fallback proof', link: 'https://example.com/fallback' },
              { key: 'rollbackProofLink', label: 'Rollback proof', link: 'https://example.com/rollback' },
              { key: 'approvalsLink', label: 'Approvals / sign-off', link: 'https://example.com/approvals' },
            ],
          })
          return spawnResult('# Decommission Evidence Log\n')
        }
        case 'check-decommission-manual-proofs.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'decommission-evidence-log.json'),
                status: 'complete',
                requiredCount: 4,
                providedCount: 4,
                missingCount: 0,
                missingProofKeys: [],
                missingProofLabels: [],
                blockers: [],
                warnings: [],
              },
              null,
              2,
            ),
          )
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
        'vps_small',
        '--env-file',
        envFile,
        '--final-summary',
        join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
        '--signoff-record',
        join(dir, 'SIGNOFF_RECORD.md'),
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
    expect(payload.blockerCount).toBe(0)
    expect(payload.automationBlockerCount).toBe(0)
    expect(payload.aoManualBlockerCount).toBe(0)
    expect(payload.warningCount).toBe(0)
    expect(payload.closeoutState).toBe('ready')
    expect(payload.aoManualState).toBe('complete')
    expect(payload.steps).toHaveLength(7)
    expect(payload.steps.map((step: { status: string }) => step.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
    expect(payload.validations.finalMigrationSummary.status).toBe('complete')
    expect(payload.validations.signoffRecord.status).toBe('complete')
    expect(payload.validations.manualProofs.status).toBe('complete')
    expect(payload.steps[5].log.status).toBe('complete')
    expect(payload.artifacts.decommissionEvidenceLogJson).toContain('decommission-evidence-log.json')
    expect(spawnSyncFn).toHaveBeenCalledTimes(7)
    expect(spawnSyncFn.mock.calls.map((call) => basename(String(call[1][0])))).toEqual([
      'check-ao-gate-evidence.js',
      'check-decommission-readiness.js',
      'validate-hosting-readiness.js',
      'validate-final-migration-summary.js',
      'validate-signoff-record.js',
      'build-decommission-evidence-log.js',
      'check-decommission-manual-proofs.js',
    ])
  })

  it('reports ao-manual-pending when AO gate evidence needs manual review', () => {
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
                result: 'WARNING',
                closeoutReady: false,
                warnings: ['manual review required'],
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
        case 'validate-hosting-readiness.js':
          return spawnResult(
            JSON.stringify(
              {
                profile: 'vps_small',
                status: 'pass',
                criticalCount: 0,
                warningCount: 0,
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'validate-final-migration-summary.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
                ok: true,
                status: 'complete',
                issueCount: 0,
                strictIssueCount: 0,
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'validate-signoff-record.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'SIGNOFF_RECORD.md'),
                ok: true,
                status: 'complete',
                blockers: [],
                warnings: [],
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
            manualProofs: [
              { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' },
              { key: 'aoFallbackLink', label: 'AO fallback proof', link: 'https://example.com/fallback' },
              { key: 'rollbackProofLink', label: 'Rollback proof', link: 'https://example.com/rollback' },
              { key: 'approvalsLink', label: 'Approvals / sign-off', link: 'https://example.com/approvals' },
            ],
          })
          return spawnResult('# Decommission Evidence Log\n')
        }
        case 'check-decommission-manual-proofs.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'decommission-evidence-log.json'),
                status: 'complete',
                requiredCount: 4,
                providedCount: 4,
                missingCount: 0,
                missingProofKeys: [],
                missingProofLabels: [],
                blockers: [],
                warnings: [],
              },
              null,
              2,
            ),
          )
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
        '--final-summary',
        join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
        '--signoff-record',
        join(dir, 'SIGNOFF_RECORD.md'),
        '--json',
      ],
      { spawnSyncFn },
    )

    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('blocked')
    expect(payload.closeoutState).toBe('ao-manual-pending')
    expect(payload.aoManualState).toBe('pending')
    expect(payload.blockerCount).toBe(1)
    expect(payload.automationBlockerCount).toBe(0)
    expect(payload.aoManualBlockerCount).toBe(1)
    expect(payload.warningCount).toBe(1)
    expect(payload.steps.map((step: { status: string }) => step.status)).toEqual([
      'warning',
      'passed',
      'skipped',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
    expect(payload.blockers.some((blocker: string) => blocker.includes('AO gate evidence check has warnings/open evidence'))).toBe(true)
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
        case 'validate-final-migration-summary.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
                ok: true,
                status: 'complete',
                issueCount: 0,
                strictIssueCount: 0,
                issues: [],
              },
              null,
              2,
            ),
          )
        case 'validate-signoff-record.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'SIGNOFF_RECORD.md'),
                ok: true,
                status: 'complete',
                blockers: [],
                warnings: [],
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
            manualProofs: [
              { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' },
              { key: 'aoFallbackLink', label: 'AO fallback proof', link: 'https://example.com/fallback' },
              { key: 'rollbackProofLink', label: 'Rollback proof', link: 'https://example.com/rollback' },
              { key: 'approvalsLink', label: 'Approvals / sign-off', link: 'https://example.com/approvals' },
            ],
          })
          return spawnResult('# Decommission Evidence Log\n')
        }
        case 'check-decommission-manual-proofs.js':
          return spawnResult(
            JSON.stringify(
              {
                file: join(dir, 'decommission-evidence-log.json'),
                status: 'complete',
                requiredCount: 4,
                providedCount: 4,
                missingCount: 0,
                missingProofKeys: [],
                missingProofLabels: [],
                blockers: [],
                warnings: [],
              },
              null,
              2,
            ),
          )
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
        '--final-summary',
        join(dir, 'FINAL_MIGRATION_SUMMARY.md'),
        '--signoff-record',
        join(dir, 'SIGNOFF_RECORD.md'),
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
    expect(payload.blockerCount).toBe(1)
    expect(payload.automationBlockerCount).toBe(1)
    expect(payload.aoManualBlockerCount).toBe(0)
    expect(payload.warningCount).toBe(0)
    expect(payload.steps.map((step: { status: string }) => step.status)).toEqual([
      'passed',
      'blocked',
      'skipped',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
    expect(payload.blockers.some((blocker: string) => blocker.includes('readiness: release-readiness.json status is warning'))).toBe(true)
    expect(spawnSyncFn.mock.calls.map((call) => basename(String(call[1][0])))).toEqual([
      'check-ao-gate-evidence.js',
      'check-decommission-readiness.js',
      'validate-final-migration-summary.js',
      'validate-signoff-record.js',
      'build-decommission-evidence-log.js',
      'check-decommission-manual-proofs.js',
    ])
  })
})
