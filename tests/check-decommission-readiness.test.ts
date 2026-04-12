import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-decommission-readiness.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'decommission-ready-'))
  tempDirs.push(dir)
  return dir
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function seedDrillDir(options = {}) {
  const {
    omit = [],
    release = '1.4.0',
    packStatus = 'ready',
    readinessStatus = 'ready',
    manifestStatus = 'ready',
    drillCheckOk = true,
    ledgerStatus = 'ready',
    gateStatuses = ['closed', 'closed', 'closed'],
  } = options as {
    omit?: string[]
    release?: string
    packStatus?: string
    readinessStatus?: string
    manifestStatus?: string
    drillCheckOk?: boolean
    ledgerStatus?: string
    gateStatuses?: string[]
  }

  const dir = makeTempDir()
  const omitSet = new Set(omit)
  const payloads: Record<string, unknown> = {
    'release-evidence-pack.json': { release, status: packStatus, blockers: [], warnings: [] },
    'release-readiness.json': { release, status: readinessStatus, blockerCount: 0, warningCount: 0 },
    'legacy-core-extraction-evidence.json': { ok: true, status: 'pass' },
    'legacy-crypto-boundary-evidence.json': { ok: true, status: 'pass' },
    'release-drill-checks.json': {
      release,
      profile: 'wedos_medium',
      mode: 'pairwise',
      strict: false,
    },
    'release-drill-manifest.json': {
      release,
      status: manifestStatus,
      artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 120, sha256: 'a'.repeat(64) }],
    },
    'release-drill-check.json': { ok: drillCheckOk, requiredCount: 5, presentCount: 5, missing: [], issues: [] },
    'release-evidence-ledger.json': {
      release,
      overallStatus: ledgerStatus,
      checks: {
        packReady: packStatus === 'ready',
        readinessReady: readinessStatus === 'ready',
        drillCheckOk,
        manifestValidated: true,
        aoGateValidated: true,
      },
    },
    'ao-dependency-gate.json': {
      schemaVersion: 1,
      release,
      updatedAt: '2026-04-11T13:35:00Z',
      required: ['p0_1_registry_contract_surface', 'p1_1_authority_rotation_workflow', 'p1_2_audit_commitments_stream'],
      checks: [
        {
          id: 'p0_1_registry_contract_surface',
          title: 'P0.1 AO integrity registry contract surface',
          status: gateStatuses[0],
          evidence: gateStatuses[0] === 'closed' ? 'evidence-a' : '',
        },
        {
          id: 'p1_1_authority_rotation_workflow',
          title: 'P1.1 Authority separation and rotation workflow',
          status: gateStatuses[1],
          evidence: gateStatuses[1] === 'closed' ? 'evidence-b' : '',
        },
        {
          id: 'p1_2_audit_commitments_stream',
          title: 'P1.2 Audit commitments stream',
          status: gateStatuses[2],
          evidence: gateStatuses[2] === 'closed' ? 'evidence-c' : '',
        },
      ],
    },
  }

  for (const [name, payload] of Object.entries(payloads)) {
    if (omitSet.has(name)) continue
    writeJson(join(dir, name), payload)
  }

  return dir
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
}

describe('check-decommission-readiness.js', () => {
  it('prints help text', () => {
    const res = runCli(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--ao-gate <FILE>')
  })

  it('reports ready state in JSON and exits cleanly without strict mode', () => {
    const dir = seedDrillDir()
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(0)
    expect(payload.status).toBe('ready')
    expect(payload.closeoutState).toBe('ready')
    expect(payload.automationState).toBe('complete')
    expect(payload.aoManualState).toBe('complete')
    expect(payload.blockerCount).toBe(0)
    expect(payload.checks.automation.status).toBe('complete')
    expect(payload.checks.aoManual.status).toBe('complete')
    expect(payload.checks.releaseEvidencePack.status).toBe('ready')
    expect(payload.checks.legacyCoreExtractionEvidence.status).toBe('pass')
    expect(payload.checks.legacyCryptoBoundaryEvidence.status).toBe('pass')
    expect(payload.checks.releaseDrillChecks.present).toBe(true)
    expect(payload.checks.releaseDrillChecks.release).toBe('1.4.0')
    expect(payload.checks.aoGate.closedCount).toBe(3)
    expect(payload.checks.aoGate.openCount).toBe(0)
  })

  it('separates automation-complete from ao-manual-pending when the gate is still open', () => {
    const dir = seedDrillDir({
      gateStatuses: ['closed', 'in_progress', 'closed'],
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(0)
    expect(payload.status).toBe('blocked')
    expect(payload.closeoutState).toBe('ao-manual-pending')
    expect(payload.automationState).toBe('complete')
    expect(payload.aoManualState).toBe('pending')
    expect(payload.checks.automation.status).toBe('complete')
    expect(payload.checks.aoManual.status).toBe('pending')
    expect(payload.checks.aoManual.openCount).toBe(1)
    expect(payload.checks.aoManual.openChecks).toEqual(['p1_1_authority_rotation_workflow'])
    expect(payload.blockers.some((blocker: string) => blocker.includes('ao gate required check is not closed'))).toBe(true)
  })

  it('separates machine blockers from ao/manual completeness', () => {
    const dir = seedDrillDir({
      omit: ['release-drill-check.json'],
      gateStatuses: ['closed', 'closed', 'closed'],
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(0)
    expect(payload.status).toBe('blocked')
    expect(payload.closeoutState).toBe('automation-blocked')
    expect(payload.automationState).toBe('blocked')
    expect(payload.aoManualState).toBe('complete')
    expect(payload.checks.automation.status).toBe('blocked')
    expect(payload.checks.aoManual.status).toBe('complete')
    expect(payload.blockers.some((blocker: string) => blocker.includes('missing required drill artifact: release-drill-check.json'))).toBe(true)
  })

  it('collects blockers for missing artifacts and open AO checks', () => {
    const dir = seedDrillDir({
      omit: ['release-drill-check.json', 'release-evidence-ledger.json'],
      packStatus: 'warning',
      readinessStatus: 'warning',
      manifestStatus: 'ready',
      drillCheckOk: false,
      ledgerStatus: 'blocked',
      gateStatuses: ['closed', 'in_progress', 'closed'],
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(0)
    expect(payload.status).toBe('blocked')
    expect(payload.closeoutState).toBe('automation-blocked')
    expect(payload.automationState).toBe('blocked')
    expect(payload.aoManualState).toBe('pending')
    expect(payload.blockerCount).toBeGreaterThan(0)
    expect(payload.blockers.some((blocker: string) => blocker.includes('missing required drill artifact: release-drill-check.json'))).toBe(true)
    expect(payload.blockers.some((blocker: string) => blocker.includes('missing required drill artifact: release-evidence-ledger.json'))).toBe(true)
    expect(payload.blockers.some((blocker: string) => blocker.includes('release-evidence-pack.json status is warning'))).toBe(true)
    expect(payload.blockers.some((blocker: string) => blocker.includes('release-readiness.json status is warning'))).toBe(true)
    expect(payload.blockers.some((blocker: string) => blocker.includes('ao gate required check is not closed'))).toBe(true)
  })

  it('fails strict mode when blockers are present', () => {
    const dir = seedDrillDir({
      packStatus: 'warning',
      gateStatuses: ['closed', 'in_progress', 'closed'],
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('# Decommission Readiness')
    expect(res.stdout).toContain('## State split')
    expect(res.stdout).toContain('## Blockers')
    expect(res.stdout).toContain('ao gate required check is not closed')
    expect(res.stdout).toContain('release-evidence-pack.json status is warning')
  })

  it('returns a usage error when required arguments are missing', () => {
    const res = runCli(['--dir', './tmp/release-drill'])

    expect(res.status).toBe(64)
    expect(res.stdout).toContain('Usage:')
    expect(res.stderr).toContain('error: --ao-gate is required')
  })
})
