import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseArgs, runCli } from '../scripts/export-consistency-report.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'consistency-report-'))
  tempDirs.push(dir)
  return dir
}

function matrixFixture(overrides = {}) {
  return {
    mode: 'pairwise',
    counts: { total: 2, pass: 1, mismatch: 1, failure: 0 },
    runs: [
      { index: 1, name: 'pair-1', status: 'PASS', outcome: 'pass' },
      { index: 2, name: 'pair-2', status: 'MISMATCH', outcome: 'mismatch', reason: 'release.root differs' },
    ],
    ...overrides,
  }
}

describe('export-consistency-report.js', () => {
  it('parses required args and defaults the optional ones', () => {
    expect(
      parseArgs(['--matrix', './tmp/matrix.json', '--out-dir', './tmp/out']),
    ).toEqual({
      help: false,
      matrix: './tmp/matrix.json',
      profile: 'vps_medium',
      outDir: './tmp/out',
      prefix: 'consistency',
    })

    expect(
      parseArgs([
        '--matrix',
        './tmp/matrix.json',
        '--profile',
        'diskless',
        '--out-dir',
        './tmp/out',
        '--prefix',
        'nightly',
      ]),
    ).toEqual({
      help: false,
      matrix: './tmp/matrix.json',
      profile: 'diskless',
      outDir: './tmp/out',
      prefix: 'nightly',
    })
  })

  it('writes the drift report and summary files using the imported summary builders', async () => {
    const root = await makeTempDir()
    const matrixPath = join(root, 'matrix.json')
    const outDir = join(root, 'artifacts')
    const reportPath = join(outDir, 'nightly-drift-report.md')
    const summaryPath = join(outDir, 'nightly-drift-summary.json')
    await writeFile(matrixPath, JSON.stringify(matrixFixture()), 'utf8')

    const result = await runCli([
      '--matrix',
      matrixPath,
      '--profile',
      'diskless',
      '--out-dir',
      outDir,
      '--prefix',
      'nightly',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.reportPath).toBe(reportPath)
    expect(result.summaryPath).toBe(summaryPath)

    const markdown = await readFile(reportPath, 'utf8')
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>

    expect(markdown).toContain('# Multi-region drift report')
    expect(markdown).toContain('Profile: diskless')
    expect(markdown).toContain('Status: **WARNING**')
    expect(markdown).toContain('GatewayIntegrityMirrorMismatch')
    expect(markdown).toContain('pair-2')

    expect(summary).toMatchObject({
      profile: 'diskless',
      mode: 'pairwise',
      status: 'warning',
      counts: { total: 2, pass: 1, mismatch: 1, failure: 0 },
      issueCount: 1,
    })
  })

  it('returns usage and data error codes for invalid args and missing matrix files', async () => {
    const root = await makeTempDir()
    const outDir = join(root, 'artifacts')

    const usageResult = await runCli(['--out-dir', outDir])
    expect(usageResult.exitCode).toBe(64)
    expect(usageResult.error).toBe('--matrix is required')

    const runtimeResult = await runCli([
      '--matrix',
      join(root, 'missing.json'),
      '--out-dir',
      outDir,
    ])
    expect(runtimeResult.exitCode).toBe(3)
    expect(runtimeResult.error).toContain('unable to read matrix file')
  })
})
