import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  parseLegacyManifestModules,
  summarizeLegacyRiskInput,
} from '../scripts/build-legacy-migration-matrix.js'

const scriptPath = fileURLToPath(new URL('../scripts/build-legacy-migration-matrix.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function runMatrix(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  })
}

function seedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'legacy-matrix-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'libs', 'legacy'), { recursive: true })
  mkdirSync(join(root, 'kernel-migration'), { recursive: true })

  const manifest = [
    '# Legacy Import Manifest',
    '',
    'Imported on: `2026-04-09`  ',
    'Importer: `scripts/import-legacy-libs.sh`',
    '',
    '## Source snapshots',
    '',
    '| Module | Source commit |',
    '|---|---|',
    '| `blackcat-analytics` | `9f69f1d` |',
    '| `blackcat-auth` | `14534b4` |',
    '| `blackcat-auth-js` | `ff46aa7` |',
    '',
    '## Included content classes',
    '',
    '- `README.md`, `LICENSE`, `NOTICE`',
  ].join('\n')

  writeFileSync(join(root, 'libs', 'legacy', 'MANIFEST.md'), `${manifest}\n`, 'utf8')
  return root
}

describe('build-legacy-migration-matrix.js', () => {
  it('parses module rows from the manifest table', () => {
    const modules = parseLegacyManifestModules([
      '# Legacy Import Manifest',
      '',
      '## Source snapshots',
      '',
      '| Module | Source commit |',
      '|---|---|',
      '| `foo` | `abc123` |',
      '| `bar` | `def456` |',
      '',
      '## Included content classes',
    ].join('\n'))

    expect(modules).toEqual([
      { module: 'foo', sourceCommit: 'abc123' },
      { module: 'bar', sourceCommit: 'def456' },
    ])
  })

  it('summarizes risk JSON counts from findings arrays', () => {
    const risk = summarizeLegacyRiskInput({
      findings: [
        { severity: 'high' },
        { severity: 'low' },
        { severity: 'high' },
        { level: 'critical' },
      ],
    })

    expect(risk.total).toBe(4)
    expect(risk.severityCounts).toMatchObject({
      critical: 1,
      high: 2,
      low: 1,
      medium: 0,
      info: 0,
      unknown: 0,
    })
  })

  it('writes the default matrix file and prints JSON summary when requested', () => {
    const root = seedWorkspace()
    const riskPath = join(root, 'risk.json')
    writeFileSync(
      riskPath,
      JSON.stringify({
        counts: {
          critical: 1,
          high: 2,
          medium: 0,
          low: 1,
          info: 0,
          unknown: 0,
        },
      }, null, 2),
      'utf8',
    )

    const res = runMatrix(['--risk', riskPath, '--json'], root)
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')

    const summary = JSON.parse(res.stdout)
    expect(summary.manifestPath).toBe(resolve(root, 'libs', 'legacy', 'MANIFEST.md'))
    expect(summary.outPath).toBe(resolve(root, 'kernel-migration', 'legacy-libs-matrix.md'))
    expect(summary.moduleCount).toBe(3)
    expect(summary.modules.map((entry: { module: string }) => entry.module)).toEqual([
      'blackcat-analytics',
      'blackcat-auth',
      'blackcat-auth-js',
    ])
    expect(summary.riskSummary.total).toBe(4)
    expect(summary.riskSummary.severityCounts.high).toBe(2)
    expect(Number.isNaN(Date.parse(summary.generatedAt))).toBe(false)

    const markdown = readFileSync(join(root, 'kernel-migration', 'legacy-libs-matrix.md'), 'utf8')
    expect(markdown).toContain('# Legacy Migration Matrix')
    expect(markdown).toContain('| `blackcat-analytics` | `9f69f1d` | pending |')
    expect(markdown).toContain('- high: 2')
    expect(markdown).toContain('- Total findings: 4')
  })

  it('supports custom paths and help output', () => {
    const root = seedWorkspace()
    const manifestPath = join(root, 'libs', 'legacy', 'MANIFEST.md')
    const outPath = join(root, 'kernel-migration', 'custom-matrix.md')

    const res = runMatrix(['--manifest', manifestPath, '--out', outPath], root)
    expect(res.status).toBe(0)
    expect(readFileSync(outPath, 'utf8')).toContain('| `blackcat-auth-js` | `ff46aa7` | pending |')
    expect(res.stdout).toContain('# Legacy Migration Matrix')

    const helpRes = runMatrix(['--help'], root)
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('build-legacy-migration-matrix.js')
    expect(helpRes.stdout).toContain('--risk <FILE>')
  })
})
