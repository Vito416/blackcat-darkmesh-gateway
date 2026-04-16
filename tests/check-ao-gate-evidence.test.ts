import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildSummary, parseArgs, runCli, validateGate } from '../scripts/check-ao-gate-evidence.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempFile(content: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'ao-gate-evidence-'))
  tempDirs.push(dir)
  const file = join(dir, 'ao-dependency-gate.json')
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`, 'utf8')
  return file
}

function gate(overrides: Record<string, unknown> = {}) {
  const now = new Date(Date.now() - 60 * 1000).toISOString()
  return {
    schemaVersion: 1,
    release: '1.4.0',
    updatedAt: now,
    required: [
      'p0_1_registry_contract_surface',
      'p1_1_authority_rotation_workflow',
      'p1_2_audit_commitments_stream',
    ],
    checks: [
      {
        id: 'p0_1_registry_contract_surface',
        title: 'P0.1 AO integrity registry contract surface',
        status: 'closed',
        evidence: 'release-drill/evidence/p0_1.md',
        notes: 'closed',
      },
      {
        id: 'p1_1_authority_rotation_workflow',
        title: 'P1.1 Authority separation and rotation workflow',
        status: 'closed',
        evidenceRefs: ['release-drill/evidence/p1_1.md'],
        notes: 'closed',
      },
      {
        id: 'p1_2_audit_commitments_stream',
        title: 'P1.2 Audit commitments stream',
        status: 'closed',
        evidence: 'release-drill/evidence/p1_2.md',
        notes: 'closed',
      },
    ],
    ...overrides,
  }
}

describe('check-ao-gate-evidence.js', () => {
  it('parses CLI args and supports --file= syntax', () => {
    const parsed = parseArgs(['--file=./ops/decommission/ao-dependency-gate.json', '--strict', '--json'])
    expect(parsed.file).toBe('./ops/decommission/ao-dependency-gate.json')
    expect(parsed.strict).toBe(true)
    expect(parsed.json).toBe(true)
  })

  it('prints usage with --help', async () => {
    const result = await runCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--file <FILE>')
  })

  it('accepts a fully closed gate and reports closeout readiness', async () => {
    const file = makeTempFile(gate())
    const summary = await buildSummary(file, { strict: false })

    expect(summary.ok).toBe(true)
    expect(summary.closeoutReady).toBe(true)
    expect(summary.issues).toHaveLength(0)
    expect(summary.warnings).toHaveLength(0)
    expect(summary.counts.closedRequired).toBe(3)
  })

  it('warns in non-strict mode when required checks are still open', async () => {
    const file = makeTempFile(
      gate({
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
            status: 'in_progress',
            evidence: '',
          },
          {
            id: 'p1_2_audit_commitments_stream',
            title: 'P1.2 Audit commitments stream',
            status: 'blocked',
            evidence: '',
          },
        ],
      }),
    )

    const result = await runCli(['--file', file])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Result: WARNING')
    expect(result.stdout).toContain('required check p1_1_authority_rotation_workflow is not closed')
    expect(result.stdout).toContain('required check p1_2_audit_commitments_stream is not closed')
  })

  it('fails in strict mode when any required check is not closed', async () => {
    const file = makeTempFile(
      gate({
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
            status: 'in_progress',
            evidence: '',
          },
          {
            id: 'p1_2_audit_commitments_stream',
            title: 'P1.2 Audit commitments stream',
            status: 'closed',
            evidence: 'release-drill/evidence/p1_2.md',
          },
        ],
      }),
    )

    const result = await runCli(['--file', file, '--strict'])
    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Result: ERROR')
    expect(result.stdout).toContain('required check p1_1_authority_rotation_workflow is not closed')
  })

  it('rejects malformed evidence quality data', async () => {
    const cases = [
      {
        name: 'duplicate check ids',
        gate: gate({
          checks: [
            {
              id: 'p0_1_registry_contract_surface',
              title: 'P0.1 AO integrity registry contract surface',
              status: 'closed',
              evidence: 'release-drill/evidence/p0_1.md',
            },
            {
              id: 'p0_1_registry_contract_surface',
              title: 'Duplicate check',
              status: 'closed',
              evidence: 'release-drill/evidence/dup.md',
            },
          ],
        }),
        message: 'checks[1].id must be unique',
      },
      {
        name: 'invalid status',
        gate: gate({
          checks: [
            {
              id: 'p0_1_registry_contract_surface',
              title: 'P0.1 AO integrity registry contract surface',
              status: 'maybe',
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
        }),
        message: 'checks[0].status must be one of open, in_progress, blocked, closed',
      },
      {
        name: 'closed check without evidence',
        gate: gate({
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
              evidence: ' ',
            },
            {
              id: 'p1_2_audit_commitments_stream',
              title: 'P1.2 Audit commitments stream',
              status: 'closed',
              evidence: 'release-drill/evidence/p1_2.md',
            },
          ],
        }),
        message: 'checks[1] must include evidence references when status is closed',
      },
      {
        name: 'future updatedAt',
        gate: gate({ updatedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
        message: 'updatedAt must not be in the future',
      },
      {
        name: 'bad release string',
        gate: gate({ release: 'release-1' }),
        message: 'release must be a semver-like string such as 1.4.0',
      },
    ]

    for (const testCase of cases) {
      const file = makeTempFile(testCase.gate)
      const result = await runCli(['--file', file, '--json'])
      expect(result.exitCode, testCase.name).toBe(3)
      const payload = JSON.parse(result.stdout)
      expect(payload.issues.join('\n'), testCase.name).toContain(testCase.message)
    }
  })

  it('prints JSON only when requested', async () => {
    const file = makeTempFile(gate())
    const result = await runCli(['--file', file, '--json'])
    const payload = JSON.parse(result.stdout)
    expect(payload.result).toBe('OK')
    expect(payload.closeoutReady).toBe(true)
    expect(payload.file).toBe(file)
  })

  it('rejects missing file arguments as usage errors', () => {
    expect(() => parseArgs([])).toThrow('--file is required')
  })

  it('flags duplicate required ids', async () => {
    const file = makeTempFile(
      gate({
        required: ['p0_1_registry_contract_surface', 'p0_1_registry_contract_surface'],
      }),
    )

    const result = await runCli(['--file', file, '--json'])
    expect(result.exitCode).toBe(3)
    const payload = JSON.parse(result.stdout)
    expect(payload.issues.join('\n')).toContain('required[1] must be unique')
  })
})
