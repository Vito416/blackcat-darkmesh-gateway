import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-production-readiness-summary.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'prod-readiness-'))
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
    manualProofLinks = {
      recoveryDrillLink: 'https://ops.example/recovery-drill',
      aoFallbackLink: 'https://ops.example/ao-fallback',
      rollbackProofLink: 'https://ops.example/rollback',
      approvalsLink: 'https://ops.example/approvals',
    },
  } = options as {
    omit?: string[]
    release?: string
    packStatus?: string
    readinessStatus?: string
    manifestStatus?: string
    drillCheckOk?: boolean
    ledgerStatus?: string
    gateStatuses?: string[]
    manualProofLinks?: {
      recoveryDrillLink?: string
      aoFallbackLink?: string
      rollbackProofLink?: string
      approvalsLink?: string
    }
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
    strict: false,
    requiredSites: [],
    providedSites: [],
    missingSites: [],
    unsupportedSites: [],
    counts: {
      providedCount: 0,
      requiredCount: 0,
      missingCount: 0,
      unsupportedCount: 0,
    },
    issues: [],
    warnings: [],
    map: {},
    supportedVariants: ['default', 'signal', 'bastion', 'horizon'],
  }
  const payloads: Record<string, unknown> = {
    'release-evidence-pack.json': { release, status: packStatus, blockers: [], warnings: [] },
    'release-readiness.json': { release, status: readinessStatus, blockerCount: 0, warningCount: 0 },
    'legacy-core-extraction-evidence.json': legacyCoreExtractionEvidence,
    'legacy-crypto-boundary-evidence.json': legacyCryptoBoundaryEvidence,
    'template-worker-map-coherence.json': templateWorkerMapCoherence,
    'forget-forward-config.json': forgetForwardConfig,
    'template-signature-ref-map.json': templateSignatureRefMap,
    'template-variant-map.json': templateVariantMap,
    'release-drill-checks.json': {
      release,
      profile: 'vps_medium',
      mode: 'pairwise',
      strict: false,
      legacyCoreExtractionEvidence,
      legacyCryptoBoundaryEvidence,
      templateWorkerMapCoherence,
      forgetForwardConfig,
      templateSignatureRefMap,
      templateVariantMap,
    },
    'release-drill-manifest.json': {
      release,
      status: manifestStatus,
      artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 120, sha256: 'a'.repeat(64) }],
    },
    'release-drill-check.json': { ok: drillCheckOk, requiredCount: 9, presentCount: 9, missing: [], issues: [] },
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
    'decommission-evidence-log.json': {
      manualProofs: [
        { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: manualProofLinks.recoveryDrillLink || '' },
        { key: 'aoFallbackLink', label: 'AO fallback proof', link: manualProofLinks.aoFallbackLink || '' },
        { key: 'rollbackProofLink', label: 'Rollback proof', link: manualProofLinks.rollbackProofLink || '' },
        { key: 'approvalsLink', label: 'Approvals / sign-off', link: manualProofLinks.approvalsLink || '' },
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

describe('check-production-readiness-summary.js', () => {
  it('reports GO when automation and AO/manual checks are complete', () => {
    const dir = seedDrillDir()
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(0)
    expect(payload.decision).toBe('GO')
    expect(payload.status).toBe('ready')
    expect(payload.closeoutState).toBe('ready')
    expect(payload.automationState).toBe('complete')
    expect(payload.aoManualState).toBe('complete')
    expect(payload.blockerCount).toBe(0)
    expect(payload.blockers).toEqual([])
  })

  it('reports NO-GO with automation-blocked when required drill artifacts are missing', () => {
    const dir = seedDrillDir({
      omit: ['release-drill-check.json'],
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(3)
    expect(payload.decision).toBe('NO-GO')
    expect(payload.status).toBe('blocked')
    expect(payload.closeoutState).toBe('automation-blocked')
    expect(payload.automationState).toBe('blocked')
    expect(payload.aoManualState).toBe('complete')
    expect(payload.blockers.some((blocker: string) => blocker.includes('release-drill-check.json'))).toBe(true)
  })

  it('reports NO-GO with ao-manual-pending in human output when AO checks are still open', () => {
    const dir = seedDrillDir({
      gateStatuses: ['closed', 'in_progress', 'closed'],
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('# Production Readiness GO/NO-GO')
    expect(res.stdout).toContain('Decision: `NO-GO`')
    expect(res.stdout).toContain('Closeout state: `ao-manual-pending`')
    expect(res.stdout).toContain('Automation state: `complete`')
    expect(res.stdout).toContain('AO/manual state: `pending`')
    expect(res.stdout).toContain('Close AO gate check p1_1_authority_rotation_workflow (current: in_progress)')
  })

  it('reports NO-GO when manual proof links are missing', () => {
    const dir = seedDrillDir({
      manualProofLinks: {
        recoveryDrillLink: '',
        aoFallbackLink: 'https://ops.example/ao-fallback',
        rollbackProofLink: '',
        approvalsLink: 'https://ops.example/approvals',
      },
    })
    const gateFile = join(dir, 'ao-dependency-gate.json')

    const res = runCli(['--dir', dir, '--ao-gate', gateFile, '--json'])
    const payload = JSON.parse(res.stdout)

    expect(res.status).toBe(3)
    expect(payload.decision).toBe('NO-GO')
    expect(payload.closeoutState).toBe('ao-manual-blocked')
    expect(payload.manualProofState).toBe('blocked')
    expect(payload.blockers.some((blocker: string) => blocker.includes('Recovery drill proof'))).toBe(true)
    expect(payload.blockers.some((blocker: string) => blocker.includes('Rollback proof'))).toBe(true)
  })
})
