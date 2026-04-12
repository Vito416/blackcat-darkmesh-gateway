import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMarkdown,
  buildSummary,
  parseArgs,
  parseMatrixJson,
  runCli,
} from '../scripts/build-drift-alert-summary.js'

function matrixFixture(overrides = {}) {
  return {
    mode: 'pairwise',
    counts: { total: 2, pass: 2, mismatch: 0, failure: 0 },
    runs: [{ index: 1, name: 'pair-1', status: 'PASS', outcome: 'pass', labels: ['#1 a', '#2 b'] }],
    ...overrides,
  }
}

describe('build-drift-alert-summary.js', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses args including output targets and profile', () => {
    const args = parseArgs([
      '--matrix',
      './tmp/matrix.json',
      '--profile',
      'diskless',
      '--out',
      './tmp/report.md',
      '--json',
      '--json-out',
      './tmp/summary.json',
    ])

    expect(args).toEqual({
      matrix: './tmp/matrix.json',
      profile: 'diskless',
      out: './tmp/report.md',
      json: true,
      jsonOut: './tmp/summary.json',
    })
  })

  it('validates matrix payload shape and extracts issues', () => {
    const parsed = parseMatrixJson(
      matrixFixture({
        counts: { total: 2, pass: 0, mismatch: 1, failure: 1 },
        runs: [
          { index: 1, name: 'pair-1', status: 'MISMATCH', outcome: 'mismatch', reason: 'release.root differs' },
          { index: 2, name: 'pair-2', status: 'FAIL', outcome: 'failure', reason: 'HTTP 503' },
        ],
      }),
    )

    expect(parsed.counts).toEqual({ total: 2, pass: 0, mismatch: 1, failure: 1 })
    expect(parsed.issues).toHaveLength(2)
    expect(parsed.issues[0].name).toBe('pair-1')
    expect(parsed.issues[1].reason).toContain('HTTP 503')
  })

  it('maps mismatch/failure counts to status and alert names', () => {
    const summary = buildSummary(
      parseMatrixJson(
        matrixFixture({
          counts: { total: 3, pass: 1, mismatch: 1, failure: 1 },
          runs: [
            { index: 1, name: 'pair-1', status: 'PASS', outcome: 'pass' },
            { index: 2, name: 'pair-2', status: 'MISMATCH', outcome: 'mismatch', reason: 'release.version differs' },
            { index: 3, name: 'pair-3', status: 'FAIL', outcome: 'failure', reason: 'HTTP 500' },
          ],
        }),
      ),
      'wedos_small',
    )

    expect(summary.status).toBe('critical')
    expect(summary.recommendedAlerts).toContain('GatewayIntegrityMirrorMismatch')
    expect(summary.recommendedAlerts).toContain('GatewayIntegrityMirrorFetchFail')
    expect(summary.recommendedAlerts).toContain('GatewayIntegrityAuditLagHigh')
    expect(summary.recommendedAlerts).toContain('GatewayIntegrityCheckpointStale')
    expect(summary.recommendedCadence).toEqual({
      timeoutMs: 4000,
      retryAttempts: 2,
      retryBackoffMs: 75,
      retryJitterMs: 25,
    })
    expect(summary.recommendedThresholds).toEqual({
      mirrorMismatchIncrease10m: 0,
      mirrorFetchFailIncrease10m: 0,
      auditLagSeconds: 1800,
      checkpointStaleSeconds: 32400,
    })
  })

  it('renders markdown with status, counts, and issue lines', () => {
    const summary = buildSummary(
      parseMatrixJson(
        matrixFixture({
          counts: { total: 2, pass: 1, mismatch: 1, failure: 0 },
          runs: [{ index: 1, name: 'pair-1', status: 'MISMATCH', outcome: 'mismatch', reason: 'audit.seqTo differs' }],
        }),
      ),
      'wedos_medium',
    )

    const markdown = buildMarkdown(summary)
    expect(markdown).toContain('# Multi-region drift report')
    expect(markdown).toContain('Status: **WARNING**')
    expect(markdown).toContain('| Mismatch | 1 |')
    expect(markdown).toContain('GatewayIntegrityMirrorMismatch')
    expect(markdown).toContain('## Profile tuning defaults')
    expect(markdown).toContain('- timeout: 5000ms')
    expect(markdown).toContain('- Audit lag (seconds): > 3600')
    expect(markdown).toContain('- Mirror mismatch / fetch fail: for: 1m')
    expect(markdown).toContain('pair-1')
  })

  it('writes markdown/json outputs from CLI flow', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'drift-summary-'))
    const matrixPath = join(dir, 'matrix.json')
    const markdownPath = join(dir, 'report.md')
    const summaryPath = join(dir, 'summary.json')
    await writeFile(matrixPath, JSON.stringify(matrixFixture()), 'utf8')

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runCli([
      '--matrix',
      matrixPath,
      '--profile',
      'wedos_medium',
      '--out',
      markdownPath,
      '--json',
      '--json-out',
      summaryPath,
    ])

    const md = await readFile(markdownPath, 'utf8')
    const json = JSON.parse(await readFile(summaryPath, 'utf8'))

    expect(md).toContain('Multi-region drift report')
    expect(json.status).toBe('ok')
    expect(json.recommendedCadence.retryAttempts).toBe(3)
    expect(json.recommendedThresholds.checkpointStaleSeconds).toBe(64800)
    expect(writeSpy).toHaveBeenCalled()
  })
})
