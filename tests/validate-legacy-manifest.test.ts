import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseManifestModules, runCli } from '../scripts/validate-legacy-manifest.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-manifest-'))
  tempDirs.push(dir)
  return dir
}

function writeText(filePath: string, text: string) {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, text, 'utf8')
}

function makeLegacyFixture({
  manifestText,
  modules,
}: {
  manifestText: string
  modules: Array<{
    name: string
    importSource: string
    includeLicense?: boolean
    includeReadme?: boolean
  }>
}) {
  const dir = makeTempDir()
  const legacyDir = join(dir, 'libs', 'legacy')
  mkdirSync(legacyDir, { recursive: true })

  const manifestPath = join(legacyDir, 'MANIFEST.md')
  writeText(manifestPath, manifestText)

  for (const module of modules) {
    const moduleDir = join(legacyDir, module.name)
    mkdirSync(moduleDir, { recursive: true })
    writeText(join(moduleDir, '.import-source'), module.importSource)
    if (module.includeLicense !== false) {
      writeText(join(moduleDir, 'LICENSE'), `license for ${module.name}\n`)
    }
    if (module.includeReadme !== false) {
      writeText(join(moduleDir, 'README.md'), `# ${module.name}\n`)
    }
  }

  return { dir, manifestPath, legacyDir }
}

function manifestText(rows: Array<[string, string]>) {
  return [
    '# Legacy Import Manifest',
    '',
    '## Source snapshots',
    '',
    '| Module | Source commit |',
    '|---|---|',
    ...rows.map(([module, commit]) => `| \`${module}\` | \`${commit}\` |`),
    '',
  ].join('\n')
}

describe('validate-legacy-manifest.js', () => {
  it('parses module rows from the manifest table', () => {
    const modules = parseManifestModules(
      manifestText([
        ['blackcat-analytics', '9f69f1d'],
        ['blackcat-auth', '14534b4'],
      ]),
    )

    expect(modules).toEqual([
      {
        moduleName: 'blackcat-analytics',
        sourceCommit: '9f69f1d',
        row: '| `blackcat-analytics` | `9f69f1d` |',
      },
      {
        moduleName: 'blackcat-auth',
        sourceCommit: '14534b4',
        row: '| `blackcat-auth` | `14534b4` |',
      },
    ])
  })

  it('accepts a valid manifest tree and reports a passing summary', () => {
    const fixture = makeLegacyFixture({
      manifestText: manifestText([
        ['blackcat-analytics', '9f69f1d'],
        ['blackcat-auth', '14534b4'],
      ]),
      modules: [
        {
          name: 'blackcat-analytics',
          importSource: 'source commit: 9f69f1d',
        },
        {
          name: 'blackcat-auth',
          importSource: 'hash marker: 14534b4',
        },
      ],
    })

    const result = runCli(['--manifest', fixture.manifestPath, '--legacy-dir', fixture.legacyDir])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Legacy import integrity passed')
    expect(result.stdout).toContain('Modules parsed: 2')
    expect(result.stdout).toContain('Problem modules: 0')
    expect(result.stdout).toContain('Issues found: 0')
  })

  it('returns structured JSON with counts and missing items', () => {
    const fixture = makeLegacyFixture({
      manifestText: manifestText([
        ['blackcat-analytics', '9f69f1d'],
        ['blackcat-auth', '14534b4'],
      ]),
      modules: [
        {
          name: 'blackcat-analytics',
          importSource: 'source commit: 9f69f1d',
        },
        {
          name: 'blackcat-auth',
          importSource: 'blackcat-auth',
          includeLicense: false,
        },
      ],
    })

    const result = runCli([
      '--manifest',
      fixture.manifestPath,
      '--legacy-dir',
      fixture.legacyDir,
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const summary = JSON.parse(result.stdout)
    expect(summary.status).toBe('issues-found')
    expect(summary.moduleCount).toBe(2)
    expect(summary.okCount).toBe(1)
    expect(summary.issueCount).toBe(1)
    expect(summary.missingItems).toEqual([
      {
        module: 'blackcat-auth',
        missingItems: ['.import-source missing commit-ish line or hash marker', 'LICENSE'],
      },
    ])
    expect(summary.modules).toHaveLength(2)
  })

  it('reports issues without failing when --strict is omitted', () => {
    const fixture = makeLegacyFixture({
      manifestText: manifestText([
        ['blackcat-analytics', '9f69f1d'],
        ['blackcat-auth', '14534b4'],
      ]),
      modules: [
        {
          name: 'blackcat-analytics',
          importSource: 'source commit: 9f69f1d',
        },
        {
          name: 'blackcat-auth',
          importSource: 'blackcat-auth',
          includeLicense: false,
          includeReadme: false,
        },
      ],
    })

    const result = runCli(['--manifest', fixture.manifestPath, '--legacy-dir', fixture.legacyDir])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Legacy import integrity issues found')
    expect(result.stdout).toContain('blackcat-auth')
    expect(result.stdout).toContain('.import-source missing commit-ish line or hash marker')
    expect(result.stdout).toContain('LICENSE')
    expect(result.stdout).toContain('README.md')
  })

  it('returns exit code 3 in strict mode when issues are found', () => {
    const fixture = makeLegacyFixture({
      manifestText: manifestText([
        ['blackcat-analytics', '9f69f1d'],
        ['blackcat-auth', '14534b4'],
      ]),
      modules: [
        {
          name: 'blackcat-analytics',
          importSource: 'source commit: 9f69f1d',
        },
        {
          name: 'blackcat-auth',
          importSource: 'blackcat-auth',
          includeLicense: false,
        },
      ],
    })

    const result = runCli([
      '--manifest',
      fixture.manifestPath,
      '--legacy-dir',
      fixture.legacyDir,
      '--strict',
    ])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Legacy import integrity issues found')
    expect(result.stderr).toBe('')
  })

  it('returns a usage error when the manifest file is missing', () => {
    const fixture = makeTempDir()
    const missingManifest = join(fixture, 'libs', 'legacy', 'MANIFEST.md')
    const legacyDir = join(fixture, 'libs', 'legacy')
    mkdirSync(legacyDir, { recursive: true })

    const result = runCli(['--manifest', missingManifest, '--legacy-dir', legacyDir])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: unable to read manifest:')
  })

  it('shows help without validating anything', () => {
    const result = runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('validate-legacy-manifest.js')
    expect(result.stderr).toBe('')
  })
})
