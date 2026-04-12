import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildReleaseEvidencePack,
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

async function seedOptionalEvidence(
  rootDir: string,
  options: {
    coreExtraction?: unknown
    legacyCryptoBoundary?: unknown
    signatureRefMap?: unknown
    templateWorkerMapCoherence?: unknown
    forgetForwardConfig?: unknown
  },
) {
  if (typeof options.coreExtraction !== 'undefined') {
    await writeFile(
      join(rootDir, 'check-legacy-core-extraction-evidence.json'),
      typeof options.coreExtraction === 'string'
        ? options.coreExtraction
        : `${JSON.stringify(options.coreExtraction, null, 2)}\n`,
      'utf8',
    )
  }

  if (typeof options.signatureRefMap !== 'undefined') {
    await writeFile(
      join(rootDir, 'check-template-signature-ref-map.json'),
      typeof options.signatureRefMap === 'string'
        ? options.signatureRefMap
        : `${JSON.stringify(options.signatureRefMap, null, 2)}\n`,
      'utf8',
    )
  }

  if (typeof options.legacyCryptoBoundary !== 'undefined') {
    await writeFile(
      join(rootDir, 'legacy-crypto-boundary-evidence.json'),
      typeof options.legacyCryptoBoundary === 'string'
        ? options.legacyCryptoBoundary
        : `${JSON.stringify(options.legacyCryptoBoundary, null, 2)}\n`,
      'utf8',
    )
  }

  if (typeof options.templateWorkerMapCoherence !== 'undefined') {
    await writeFile(
      join(rootDir, 'template-worker-map-coherence.json'),
      typeof options.templateWorkerMapCoherence === 'string'
        ? options.templateWorkerMapCoherence
        : `${JSON.stringify(options.templateWorkerMapCoherence, null, 2)}\n`,
      'utf8',
    )
  }

  if (typeof options.forgetForwardConfig !== 'undefined') {
    await writeFile(
      join(rootDir, 'forget-forward-config.json'),
      typeof options.forgetForwardConfig === 'string'
        ? options.forgetForwardConfig
        : `${JSON.stringify(options.forgetForwardConfig, null, 2)}\n`,
      'utf8',
    )
  }
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
      './ops/decommission/ao-dependency-gate.json',
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
      aoGateFile: './ops/decommission/ao-dependency-gate.json',
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

  it('treats AO gate failures as warnings when require-ao-gate is disabled', () => {
    const readiness = combineReadiness(
      { present: true, status: 'pass', reason: 'ok' },
      { present: true, status: 'pass', reason: 'ok' },
      { present: true, status: 'fail', reason: 'required AO checks still in progress' },
      true,
      false,
    )

    expect(readiness.status).toBe('warning')
    expect(readiness.blockers).toEqual([])
    expect(readiness.warnings).toEqual(['ao dependency gate status=fail: required AO checks still in progress'])
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

  it('includes optional drill evidence when valid JSON artifacts are present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'release-pack-optional-valid-'))
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
    await seedOptionalEvidence(consistencyDir, {
      coreExtraction: {
        ok: true,
        status: 'pass',
        strict: true,
        runtimeMissing: [],
        testMissing: [],
        importFindingCount: 0,
      },
      signatureRefMap: {
        ok: true,
        status: 'complete',
        strict: true,
        requiredSites: ['alpha', 'beta'],
        providedSites: ['alpha', 'beta'],
        missingSites: [],
        counts: { providedCount: 2, requiredCount: 2, missingCount: 0, emptyValueCount: 0 },
        issues: [],
        warnings: [],
        map: { alpha: 'sig-alpha', beta: 'sig-beta' },
      },
      legacyCryptoBoundary: {
        ok: true,
        status: 'pass',
        strict: true,
        importFindingCount: 0,
        forbiddenSigningFindingCount: 0,
        runtimeMissing: [],
        testMissing: [],
      },
      templateWorkerMapCoherence: {
        ok: true,
        status: 'complete',
        strict: true,
        counts: {
          urlMapCount: 2,
          tokenMapCount: 2,
          signatureRefMapCount: 2,
          requiredSiteCount: 0,
          missingRequiredSiteCount: 0,
          missingTokenCount: 0,
          missingSignatureRefCount: 0,
          extraTokenCount: 0,
          extraSignatureRefCount: 0,
        },
        issues: [],
        warnings: [],
      },
      forgetForwardConfig: {
        ok: false,
        strict: false,
        status: 'pending',
        values: {
          url: '',
          token: '',
          timeoutMs: 3000,
          timeoutSource: 'default',
        },
        issues: [],
        warnings: ['forget-forward relay is disabled because the URL is not set'],
      },
    })
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

    const args = parseArgs([
      '--release',
      '1.4.0',
      '--consistency-dir',
      consistencyDir,
      '--evidence-dir',
      evidenceDir,
      '--ao-gate-file',
      aoGatePath,
      '--require-both',
      '--require-ao-gate',
    ])
    const { pack, markdown } = await buildReleaseEvidencePack(args)

    expect(pack.status).toBe('ready')
    expect(pack.optionalEvidence.coreExtraction.status).toBe('pass')
    expect(pack.optionalEvidence.legacyCryptoBoundary.status).toBe('pass')
    expect(pack.optionalEvidence.templateSignatureRefMap.status).toBe('pass')
    expect(pack.optionalEvidence.templateWorkerMapCoherence.status).toBe('pass')
    expect(pack.optionalEvidence.forgetForwardConfig.status).toBe('pass')
    expect(pack.blockers).toEqual([])
    expect(markdown).toContain('## Optional evidence')
    expect(markdown).toContain('Core extraction evidence')
    expect(markdown).toContain('Legacy crypto boundary evidence')
    expect(markdown).toContain('Template signature-ref map evidence')
    expect(markdown).toContain('Template worker map coherence evidence')
    expect(markdown).toContain('Forget-forward config evidence')
  })

  it('keeps missing optional drill evidence additive even when require-both is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'release-pack-optional-missing-'))
    const consistencyDir = join(dir, 'consistency')
    const evidenceDir = join(dir, 'evidence')
    await mkdir(consistencyDir, { recursive: true })
    await mkdir(evidenceDir, { recursive: true })

    await writeFile(
      join(consistencyDir, 'consistency-matrix.json'),
      JSON.stringify({
        mode: 'pairwise',
        counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
      }),
      'utf8',
    )
    await writeFile(
      join(consistencyDir, 'consistency-drift-summary.json'),
      JSON.stringify({
        status: 'ok',
        counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
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
          { id: 'p0_1_registry_contract_surface', status: 'closed' },
          { id: 'p1_1_authority_rotation_workflow', status: 'closed' },
          { id: 'p1_2_audit_commitments_stream', status: 'closed' },
        ],
      }),
      'utf8',
    )

    const args = parseArgs([
      '--release',
      '1.4.0',
      '--consistency-dir',
      consistencyDir,
      '--evidence-dir',
      evidenceDir,
      '--ao-gate-file',
      aoGatePath,
      '--require-both',
      '--require-ao-gate',
    ])
    const { pack, markdown } = await buildReleaseEvidencePack(args)

    expect(pack.status).toBe('ready')
    expect(pack.optionalEvidence.coreExtraction.status).toBe('missing')
    expect(pack.optionalEvidence.legacyCryptoBoundary.status).toBe('missing')
    expect(pack.optionalEvidence.templateSignatureRefMap.status).toBe('missing')
    expect(pack.optionalEvidence.templateWorkerMapCoherence.status).toBe('missing')
    expect(pack.optionalEvidence.forgetForwardConfig.status).toBe('missing')
    expect(pack.blockers).toEqual([])
    expect(markdown).toContain('Present: no')
    expect(markdown).toContain('Reason: artifact file not found')
  })

  it('fails when an optional drill evidence JSON file is invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'release-pack-optional-invalid-'))
    const consistencyDir = join(dir, 'consistency')
    const evidenceDir = join(dir, 'evidence')
    await mkdir(consistencyDir, { recursive: true })
    await mkdir(evidenceDir, { recursive: true })

    await writeFile(
      join(consistencyDir, 'consistency-matrix.json'),
      JSON.stringify({
        mode: 'pairwise',
        counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
      }),
      'utf8',
    )
    await writeFile(
      join(consistencyDir, 'consistency-drift-summary.json'),
      JSON.stringify({
        status: 'ok',
        counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
      }),
      'utf8',
    )
    await seedEvidence(evidenceDir)
    await writeFile(join(consistencyDir, 'check-legacy-core-extraction-evidence.json'), '{not-json', 'utf8')
    const aoGatePath = join(dir, 'ao-dependency-gate.json')
    await writeFile(
      aoGatePath,
      JSON.stringify({
        required: ['p0_1_registry_contract_surface', 'p1_1_authority_rotation_workflow', 'p1_2_audit_commitments_stream'],
        checks: [
          { id: 'p0_1_registry_contract_surface', status: 'closed' },
          { id: 'p1_1_authority_rotation_workflow', status: 'closed' },
          { id: 'p1_2_audit_commitments_stream', status: 'closed' },
        ],
      }),
      'utf8',
    )

    const args = parseArgs([
      '--release',
      '1.4.0',
      '--consistency-dir',
      consistencyDir,
      '--evidence-dir',
      evidenceDir,
      '--ao-gate-file',
      aoGatePath,
      '--require-both',
      '--require-ao-gate',
    ])
    const { pack, markdown } = await buildReleaseEvidencePack(args)

    expect(pack.status).toBe('not-ready')
    expect(pack.blockers.some((item) => item.includes('core extraction evidence invalid JSON'))).toBe(true)
    expect(pack.optionalEvidence.coreExtraction.status).toBe('invalid')
    expect(markdown).toContain('Status: **NOT-READY**')
    expect(markdown).toContain('invalid JSON')
  })
})
