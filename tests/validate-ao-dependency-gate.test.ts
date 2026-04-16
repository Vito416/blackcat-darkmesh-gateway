import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/validate-ao-dependency-gate.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function buildGate(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    release: '1.4.0',
    updatedAt: '2026-04-11T13:35:00Z',
    required: [
      'p0_1_registry_contract_surface',
      'p1_1_authority_rotation_workflow',
      'p1_2_audit_commitments_stream',
    ],
    checks: [
      {
        id: 'p0_1_registry_contract_surface',
        title: 'P0.1 AO integrity registry contract surface',
        status: 'in_progress',
        evidence: '',
        notes: 'AO publish/revoke/query/pause API surface still tracked as open in backlog.',
      },
      {
        id: 'p1_1_authority_rotation_workflow',
        title: 'P1.1 Authority separation and rotation workflow',
        status: 'in_progress',
        evidence: '',
        notes: 'Gateway role-aware enforcement is landed; AO-side final lifecycle completion still pending.',
      },
      {
        id: 'p1_2_audit_commitments_stream',
        title: 'P1.2 Audit commitments stream',
        status: 'in_progress',
        evidence: '',
        notes: 'Gateway audit gauges are landed; AO-side immutable commitment sequencing/query API still pending.',
      },
    ],
    ...overrides,
  }
}

function writeGateFile(gate: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'ao-dependency-gate-'))
  tempDirs.push(dir)
  const file = join(dir, 'ao-dependency-gate.json')
  writeFileSync(file, `${JSON.stringify(gate, null, 2)}\n`, 'utf8')
  return file
}

function runValidator(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('validate-ao-dependency-gate.js', () => {
  it('prints help and exits cleanly', () => {
    const res = runValidator(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--file <PATH>')
  })

  it('accepts a valid dependency gate', () => {
    const file = writeGateFile(buildGate())
    const res = runValidator(['--file', file])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`valid dependency gate: ${file}`)
    expect(res.stderr).toBe('')
  })

  it('rejects malformed dependency gates with exit code 3', () => {
    const cases = [
      {
        name: 'duplicate required ids',
        gate: buildGate({ required: ['p0_1_registry_contract_surface', 'p0_1_registry_contract_surface'] }),
        message: 'required[1] must be unique',
      },
      {
        name: 'duplicate check ids',
        gate: buildGate({
          checks: [
            {
              id: 'p0_1_registry_contract_surface',
              title: 'P0.1 AO integrity registry contract surface',
              status: 'in_progress',
              evidence: '',
            },
            {
              id: 'p0_1_registry_contract_surface',
              title: 'Duplicate check',
              status: 'open',
              evidence: '',
            },
          ],
        }),
        message: 'checks[1].id must be unique',
      },
      {
        name: 'missing required check',
        gate: buildGate({
          checks: [
            {
              id: 'p0_1_registry_contract_surface',
              title: 'P0.1 AO integrity registry contract surface',
              status: 'in_progress',
              evidence: '',
            },
          ],
        }),
        message: 'required id p1_1_authority_rotation_workflow must be present in checks',
      },
      {
        name: 'invalid status',
        gate: buildGate({
          checks: [
            {
              id: 'p0_1_registry_contract_surface',
              title: 'P0.1 AO integrity registry contract surface',
              status: 'maybe',
              evidence: '',
            },
          ],
        }),
        message: 'checks[0].status must be one of open, in_progress, blocked, closed',
      },
    ]

    for (const testCase of cases) {
      const file = writeGateFile(testCase.gate as Record<string, unknown>)
      const res = runValidator(['--file', file])
      expect(res.status, testCase.name).toBe(3)
      expect(res.stderr, testCase.name).toContain('invalid dependency gate:')
      expect(res.stderr, testCase.name).toContain(testCase.message)
    }
  })

  it('rejects closed checks without evidence', () => {
    const file = writeGateFile(
      buildGate({
        checks: [
          {
            id: 'p0_1_registry_contract_surface',
            title: 'P0.1 AO integrity registry contract surface',
            status: 'closed',
            evidence: '',
          },
        ],
        required: ['p0_1_registry_contract_surface'],
      }),
    )

    const res = runValidator(['--file', file])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('checks[0].evidence must be a non-empty string when status is closed')
  })

  it('returns usage error when --file is missing', () => {
    const res = runValidator([])
    expect(res.status).toBe(64)
    expect(res.stderr).toContain('error: --file is required')
  })
})
