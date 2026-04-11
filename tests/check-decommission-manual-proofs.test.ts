import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REQUIRED_PROOF_KEYS, assessManualProofs, runCli } from '../scripts/check-decommission-manual-proofs.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'manual-proof-check-'))
  tempDirs.push(dir)
  return dir
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

describe('check-decommission-manual-proofs.js', () => {
  it('passes when all required manual proof links are present', () => {
    const dir = makeTempDir()
    const file = join(dir, 'decommission-evidence-log.json')
    writeJson(file, {
      manualProofs: [
        { key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' },
        { key: 'aoFallbackLink', label: 'AO fallback proof', link: 'https://example.com/fallback' },
        { key: 'rollbackProofLink', label: 'Rollback proof', link: 'https://example.com/rollback' },
        { key: 'approvalsLink', label: 'Approvals / sign-off', link: 'https://example.com/approvals' },
      ],
    })

    const result = runCli(['--file', file, '--json', '--strict'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('complete')
    expect(payload.providedCount).toBe(REQUIRED_PROOF_KEYS.length)
    expect(payload.missingCount).toBe(0)
  })

  it('reports pending in non-strict mode when manual proofs are missing', () => {
    const dir = makeTempDir()
    const file = join(dir, 'decommission-evidence-log.json')
    writeJson(file, {
      manualProofs: [{ key: 'recoveryDrillLink', label: 'Recovery drill proof', link: 'https://example.com/recovery' }],
    })

    const result = runCli(['--file', file, '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('pending')
    expect(payload.missingCount).toBe(3)
    expect(payload.missingProofKeys).toContain('aoFallbackLink')
  })

  it('fails in strict mode when manual proofs are missing', () => {
    const dir = makeTempDir()
    const file = join(dir, 'decommission-evidence-log.json')
    writeJson(file, { manualProofs: [] })

    const result = runCli(['--file', file, '--strict'])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Missing manual proofs')
    expect(result.stdout).toContain('Recovery drill proof')
  })

  it('returns usage error when file argument is missing', () => {
    const result = runCli([])
    expect(result.exitCode).toBe(64)
    expect(result.stderr).toContain('--file is required')
  })

  it('treats invalid log payload as blocked', () => {
    const summary = assessManualProofs(null)
    expect(summary.status).toBe('blocked')
    expect(summary.missingCount).toBe(REQUIRED_PROOF_KEYS.length)
    expect(summary.blockers.length).toBeGreaterThan(0)
  })
})
