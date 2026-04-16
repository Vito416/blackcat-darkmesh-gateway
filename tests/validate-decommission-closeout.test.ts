import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli, validateDecommissionCloseout } from '../scripts/validate-decommission-closeout.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'decommission-closeout-validate-'))
  tempDirs.push(dir)
  const file = join(dir, 'closeout.json')
  writeFileSync(file, text, 'utf8')
  return file
}

function writeJson(payload: unknown) {
  return `${JSON.stringify(payload, null, 2)}\n`
}

function readyPayload() {
  return {
    status: 'ready',
    closeoutState: 'ready',
    automationState: 'complete',
    aoManualState: 'complete',
    steps: [
      { id: 'check-ao-gate-evidence', label: 'Check AO gate evidence', status: 'passed', exitCode: 0 },
      { id: 'check-decommission-readiness', label: 'Check decommission readiness', status: 'passed', exitCode: 0 },
      { id: 'validate-final-migration-summary', label: 'Validate final migration summary', status: 'passed', exitCode: 0 },
      { id: 'validate-signoff-record', label: 'Validate signoff record', status: 'passed', exitCode: 0 },
      { id: 'build-decommission-evidence-log', label: 'Build decommission evidence log', status: 'passed', exitCode: 0 },
      { id: 'check-decommission-manual-proofs', label: 'Check manual proof links', status: 'passed', exitCode: 0 },
    ],
    blockers: [],
    automationBlockers: [],
    aoManualBlockers: [],
    warnings: [],
    validations: {
      manualProofs: {
        status: 'complete',
        requiredCount: 4,
        providedCount: 4,
        missingCount: 0,
        missingProofKeys: [],
        missingProofLabels: [],
        blockers: [],
        warnings: [],
        proofs: [
          { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' },
          { key: 'aoFallbackLink', label: 'AO fallback proof', link: 'https://example.com/fallback' },
          { key: 'rollbackProofLink', label: 'Rollback proof', link: 'https://example.com/rollback' },
          { key: 'approvalsLink', label: 'Approvals / sign-off', link: 'https://example.com/approvals' },
        ],
      },
    },
  }
}

function pendingPayload() {
  return {
    status: 'blocked',
    closeoutState: 'ao-manual-pending',
    automationState: 'complete',
    aoManualState: 'pending',
    steps: [
      { id: 'check-ao-gate-evidence', label: 'Check AO gate evidence', status: 'passed' },
      { id: 'check-decommission-readiness', label: 'Check decommission readiness', status: 'blocked' },
      { id: 'validate-final-migration-summary', label: 'Validate final migration summary', status: 'passed' },
      { id: 'validate-signoff-record', label: 'Validate signoff record', status: 'passed' },
      { id: 'build-decommission-evidence-log', label: 'Build decommission evidence log', status: 'passed' },
      { id: 'check-decommission-manual-proofs', label: 'Check manual proof links', status: 'blocked' },
    ],
    blockers: [],
    automationBlockers: [],
    aoManualBlockers: ['manual proofs still pending'],
    warnings: ['waiting for manual proof links'],
    validations: {
      manualProofs: {
        status: 'pending',
        requiredCount: 4,
        providedCount: 1,
        missingCount: 3,
        missingProofKeys: ['aoFallbackLink', 'rollbackProofLink', 'approvalsLink'],
        missingProofLabels: ['AO fallback proof', 'Rollback proof', 'Approvals / sign-off'],
        blockers: [],
        warnings: ['manual proofs still pending'],
        proofs: [
          { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' },
        ],
      },
    },
  }
}

describe('validate-decommission-closeout.js', () => {
  it('accepts a ready closeout payload in strict mode', () => {
    const payload = readyPayload()
    const file = makeTempFile(writeJson(payload))

    const result = runCli(['--file', file, '--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('ready')
    expect(parsed.ready).toBe(true)
    expect(parsed.malformed).toBe(false)
    expect(parsed.blockerCount).toBe(0)
    expect(parsed.warningCount).toBe(0)
    expect(parsed.validations.manualProofs.status).toBe('complete')
    expect(parsed.steps).toHaveLength(6)
  })

  it('reports a pending payload without failing non-strict mode', () => {
    const file = makeTempFile(writeJson(pendingPayload()))

    const loose = runCli(['--file', file])
    expect(loose.exitCode).toBe(0)
    expect(loose.stdout).toContain('Status: `blocked`')
    expect(loose.stdout).toContain('AO/manual state: `pending`')
    expect(loose.stdout).toContain('waiting for manual proof links')
    expect(loose.stdout).toContain('## Blockers')

    const strict = runCli(['--file', file, '--strict', '--json'])
    const parsed = JSON.parse(strict.stdout)

    expect(strict.exitCode).toBe(3)
    expect(parsed.ok).toBe(false)
    expect(parsed.status).toBe('blocked')
    expect(parsed.ready).toBe(false)
    expect(parsed.blockerCount).toBeGreaterThan(0)
    expect(parsed.warningCount).toBeGreaterThan(0)
    expect(parsed.validations.manualProofs.status).toBe('pending')
  })

  it('fails closed on malformed payloads', () => {
    const file = makeTempFile(writeJson({ status: 'ready', closeoutState: 'ready' }))

    const result = runCli(['--file', file, '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.ok).toBe(false)
    expect(parsed.malformed).toBe(true)
    expect(parsed.issues.length).toBeGreaterThan(0)
    expect(parsed.status).toBe('invalid')
  })

  it('returns usage text on missing file argument', () => {
    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('--file is required')
  })

  it('can be used as a pure validator helper', () => {
    const result = validateDecommissionCloseout(readyPayload())

    expect(result.ok).toBe(true)
    expect(result.ready).toBe(true)
    expect(result.malformed).toBe(false)
    expect(result.validations.manualProofs?.status).toBe('complete')
  })
})
