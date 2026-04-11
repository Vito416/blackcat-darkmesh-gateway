import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  combineReadiness,
  collectAoDependencyGate,
  normalizeAoStatus,
  parseArgs,
  parseTimestampFromDir,
  renderMarkdown,
  resolveConsistencyStatus,
  runCli,
} from '../scripts/build-release-evidence-pack.js'

async function seedEvidence(rootDir: string) {
  const bundleDir = join(rootDir, '2026-04-11T10-30-00Z-1234-abcd12')
  await mkdir(bundleDir, { recursive: true })
  await writeFile(join(bundleDir, 'compare.txt'), 'compare ok\n', 'utf8')
  await writeFile(join(bundleDir, 'attestation.json'), JSON.stringify({ digest: 'sha256:abc' }), 'utf8')
  await writeFile(
    join(bundleDir, 'manifest.json'),
    JSON.stringify({
      status: 'ok',
      compare: { exitCode: 0 },
      attestation: { exitCode: 0 },
      urls: ['https://gateway-a.example.com', 'https://gateway-b.example.com'],
    }),
    'utf8',
  )
  await writeFile(
    join(rootDir, 'attestation-exchange-pack.json'),
    JSON.stringify({ summary: { total: 1, ok: 1, failed: 0 } }),
    'utf8',
  )
}

describe('build-release-evidence-pack.js', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses required args and flags', () => {
    const args = parseArgs([
      '--release',
      '1.4.0',
      '--consistency-dir',
      './tmp/consistency',
      '--evidence-dir',
      './tmp/evidence',
      '--ao-gate-file',
      './kernel-migration/ao-dependency-gate.json',
      '--out',
      './tmp/report.md',
      '--json-out',
      './tmp/report.json',
      '--require-both',
      '--require-ao-gate',
      '--json',
    ])

    expect(args).toEqual({
      release: '1.4.0',
      consistencyDir: './tmp/consistency',
      evidenceDir: './tmp/evidence',
      aoGateFile: './kernel-migration/ao-dependency-gate.json',
      out: './tmp/report.md',
      jsonOut: './tmp/report.json',
      requireBoth: true,
      requireAoGate: true,
      json: true,
    })
  })

  it('parses timestamped bundle names', () => {
    const parsed = parseTimestampFromDir('2026-04-11T10-30-00Z-1234-abcd12')
    expect(parsed?.iso).toBe('2026-04-11T10:30:00Z')
    expect(parseTimestampFromDir('not-a-bundle')).toBeNull()
  })

  it('maps matrix counts to pass/warn/fail', () => {
    expect(resolveConsistencyStatus({ counts: { mismatch: 0, failure: 0 } }).status).toBe('pass')
    expect(resolveConsistencyStatus({ counts: { mismatch: 2, failure: 0 } }).status).toBe('warn')
    expect(resolveConsistencyStatus({ counts: { mismatch: 0, failure: 1 } }).status).toBe('fail')
  })

  it('computes blockers and warnings', () => {
    const ready = combineReadiness(
      { present: true, status: 'pass', reason: 'ok' },
      { present: true, status: 'pass', reason: 'ok' },
      { present: true, status: 'pass', reason: 'ok' },
      true,
      true,
    )
    expect(ready.status).toBe('ready')

    const notReady = combineReadiness(
      { present: true, status: 'fail', reason: 'fetch failures' },
      { present: false, status: 'missing', reason: 'no bundle' },
      { present: true, status: 'fail', reason: '2 required AO check(s) not closed' },
      true,
      true,
    )
    expect(notReady.status).toBe('not-ready')
    expect(notReady.blockers.length).toBeGreaterThanOrEqual(2)
  })

  it('propagates AO gate and consistency blockers into a not-ready pack', () => {
    const readiness = combineReadiness(
      { present: true, status: 'fail', reason: '1 failure run(s)' },
      { present: true, status: 'pass', reason: 'latest bundle strict markers are ok' },
      { present: true, status: 'fail', reason: '1 required AO check(s) not closed' },
      true,
      true,
    )

    expect(readiness.status).toBe('not-ready')
    expect(readiness.blockers).toEqual([
      'consistency status=fail: 1 failure run(s)',
      'ao dependency gate status=fail: 1 required AO check(s) not closed',
    ])
    expect(readiness.warnings).toEqual([])

    const markdown = renderMarkdown({
      createdAt: '2026-04-11T10:20:30.000Z',
      release: '1.4.0',
      status: readiness.status,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      consistency: { present: true, status: 'fail', reason: '1 failure run(s)' },
      evidence: { present: true, status: 'pass', reason: 'latest bundle strict markers are ok' },
      aoGate: { present: true, status: 'fail', reason: '1 required AO check(s) not closed' },
    })

    expect(markdown).toContain('- Status: **NOT-READY**')
    expect(markdown).toContain('## Blockers')
    expect(markdown).toContain('- consistency status=fail: 1 failure run(s)')
    expect(markdown).toContain('- ao dependency gate status=fail: 1 required AO check(s) not closed')
  })

  it('normalizes AO statuses and validates AO gate file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'release-pack-ao-'))
    const aoGatePath = join(dir, 'ao-gate.json')
    await writeFile(
      aoGatePath,
      JSON.stringify({
        required: ['p0_1_registry_contract_surface', 'p1_1_authority_rotation_workflow', 'p1_2_audit_commitments_stream'],
        checks: [
          { id: 'p0_1_registry_contract_surface', status: 'closed' },
          { id: 'p1_1_authority_rotation_workflow', status: 'done' },
          { id: 'p1_2_audit_commitments_stream', status: 'ok' },
        ],
      }),
      'utf8',
    )

    expect(normalizeAoStatus('in-progress')).toBe('in_progress')
    expect(normalizeAoStatus('done')).toBe('closed')

    const gate = await collectAoDependencyGate(aoGatePath)
    expect(gate.status).toBe('pass')
    expect(gate.requiredChecks).toHaveLength(3)
  })

  it('creates markdown and json outputs from consistency/evidence inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'release-pack-'))
    const consistencyDir = join(dir, 'consistency')
    const evidenceDir = join(dir, 'evidence')
    await mkdir(consistencyDir, { recursive: true })
    await mkdir(evidenceDir, { recursive: true })

    await writeFile(
      join(consistencyDir, 'consistency-matrix.json'),
      JSON.stringify({
        mode: 'pairwise',
        counts: { total: 2, pass: 2, mismatch: 0, failure: 0 },
      }),
      'utf8',
    )
    await writeFile(
      join(consistencyDir, 'consistency-drift-summary.json'),
      JSON.stringify({
        status: 'ok',
        counts: { total: 2, pass: 2, mismatch: 0, failure: 0 },
      }),
      'utf8',
    )
    await seedEvidence(evidenceDir)
    const aoGatePath = join(dir, 'ao-dependency-gate.json')
    await writeFile(
      aoGatePath,
      JSON.stringify({
        required: ['p0_1_registry_contract_surface', 'p1_1_authority_rotation_workflow', 'p1_2_audit_commitments_stream'],
        checks: [
          { id: 'p0_1_registry_contract_surface', status: 'closed', evidence: 'ao-pr-101' },
          { id: 'p1_1_authority_rotation_workflow', status: 'closed', evidence: 'ao-pr-102' },
          { id: 'p1_2_audit_commitments_stream', status: 'closed', evidence: 'ao-pr-103' },
        ],
      }),
      'utf8',
    )

    const markdownPath = join(dir, 'release-evidence-pack.md')
    const jsonPath = join(dir, 'release-evidence-pack.json')
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runCli([
      '--release',
      '1.4.0',
      '--consistency-dir',
      consistencyDir,
      '--evidence-dir',
      evidenceDir,
      '--ao-gate-file',
      aoGatePath,
      '--require-ao-gate',
      '--out',
      markdownPath,
      '--json-out',
      jsonPath,
    ])

    const markdown = await readFile(markdownPath, 'utf8')
    const json = JSON.parse(await readFile(jsonPath, 'utf8'))
    expect(markdown).toContain('Release Evidence Pack')
    expect(markdown).toContain('Status: **READY**')
    expect(markdown).toContain('AO dependency gate')
    expect(json.status).toBe('ready')
    expect(json.aoGate.status).toBe('pass')
    expect(writeSpy).toHaveBeenCalled()
  })
})
