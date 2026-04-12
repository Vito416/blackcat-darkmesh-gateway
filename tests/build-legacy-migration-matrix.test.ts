import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  parseLegacyCorePrimitiveMap,
  parseLegacyManifestModules,
  renderLegacyMigrationMatrix,
  summarizeLegacyCorePrimitiveMap,
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
  mkdirSync(join(root, 'kernel-migration', 'legacy-archive', 'snapshots'), { recursive: true })
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
    '| `blackcat-core` | `f1c3dc7` |',
    '',
    '## Included content classes',
    '',
    '- `README.md`, `LICENSE`, `NOTICE`',
  ].join('\n')

  writeFileSync(join(root, 'kernel-migration', 'legacy-archive', 'MANIFEST.md'), `${manifest}\n`, 'utf8')
  const moduleMap = [
    '# Legacy Module Map',
    '',
    '| module | source commit | gateway target path | current status | owner/workstream | notes |',
    '| --- | --- | --- | --- | --- | --- |',
    '| `blackcat-analytics` | `9f69f1d` | `src/runtime/telemetry/analyticsEvent.ts` | `extracted` | `gateway-libs-consolidation:P2` | `ok` |',
    '| `blackcat-auth` | `14534b4` | `src/runtime/auth/httpAuth.ts` | `extracted` | `gateway-libs-consolidation:P0` | `ok` |',
    '| `blackcat-auth-js` | `ff46aa7` | `src/clients/auth-sdk/client.ts` | `extracted` | `gateway-libs-consolidation:P1` | `ok` |',
    '| `blackcat-core` | `f1c3dc7` | `src/runtime/core/` | `extracted` | `gateway-libs-consolidation:P0` | `ok` |',
  ].join('\n')
  writeFileSync(join(root, 'kernel-migration', 'LEGACY_MODULE_MAP.md'), `${moduleMap}\n`, 'utf8')
  return root
}

function seedCorePrimitiveMap(root: string) {
  writeFileSync(
    join(root, 'kernel-migration', 'core-primitive-map.json'),
    JSON.stringify(
      {
        module: 'blackcat-core',
        sourceCommit: 'f1c3dc7',
        status: 'in progress',
        requestPathProof: 'rg -n "libs/legacy/blackcat-core" src',
        primitiveGroups: [
          {
            name: 'byte helpers',
            legacySymbols: ['readPositiveInteger', 'utf8ByteLength', 'bodyExceedsUtf8Limit'],
            gatewayPaths: ['src/runtime/core/bytes.ts'],
            tests: ['tests/runtime-core-bytes.test.ts'],
            proof: 'byte sizing and positive-integer parsing are gateway-owned and covered by focused tests',
          },
          {
            name: 'template helpers',
            legacySymbols: ['template action guards', 'template backend validation'],
            gatewayPaths: ['src/runtime/template/actions.ts', 'src/runtime/template/validators.ts'],
            tests: ['tests/template-api.test.ts', 'tests/validate-template-backend-contract.test.ts'],
            proof: 'template runtime remains gateway-owned and contract-checked before legacy removal',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )
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

  it('parses and summarizes machine-readable core primitive mappings', () => {
    const parsed = parseLegacyCorePrimitiveMap({
      module: 'blackcat-core',
      sourceCommit: 'f1c3dc7',
      status: 'in progress',
      requestPathProof: 'rg -n "libs/legacy/blackcat-core" src',
      primitiveGroups: [
        {
          name: 'byte helpers',
          legacySymbols: ['readPositiveInteger', 'utf8ByteLength'],
          gatewayPaths: ['src/runtime/core/bytes.ts'],
          tests: ['tests/runtime-core-bytes.test.ts'],
          proof: 'byte helper coverage',
        },
      ],
    })

    expect(parsed.module).toBe('blackcat-core')
    expect(parsed.primitiveGroups).toHaveLength(1)
    expect(parsed.primitiveGroups[0]).toMatchObject({
      name: 'byte helpers',
      status: 'mapped',
    })

    const summary = summarizeLegacyCorePrimitiveMap({
      module: 'blackcat-core',
      sourceCommit: 'f1c3dc7',
      status: 'in progress',
      requestPathProof: 'rg -n "libs/legacy/blackcat-core" src',
      primitiveGroups: [
        {
          name: 'byte helpers',
          legacySymbols: ['readPositiveInteger', 'utf8ByteLength'],
          gatewayPaths: ['src/runtime/core/bytes.ts'],
          tests: ['tests/runtime-core-bytes.test.ts'],
          proof: 'byte helper coverage',
        },
        {
          name: 'template helpers',
          legacySymbols: ['template action guards'],
          gatewayPaths: ['src/runtime/template/actions.ts'],
          tests: ['tests/template-api.test.ts'],
          proof: 'template contract coverage',
          status: 'validated',
        },
      ],
    })

    expect(summary).toMatchObject({
      module: 'blackcat-core',
      sourceCommit: 'f1c3dc7',
      primitiveGroupCount: 2,
      mappedGroupCount: 2,
      testCount: 2,
    })
    expect(summary.tableSummary).toBe('2 primitive groups, 2 tests')
  })

  it('writes the default matrix file and prints JSON summary when requested', () => {
    const root = seedWorkspace()
    seedCorePrimitiveMap(root)
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
    expect(summary.manifestPath).toBe(resolve(root, 'kernel-migration', 'legacy-archive', 'MANIFEST.md'))
    expect(summary.outPath).toBe(resolve(root, 'kernel-migration', 'legacy-libs-matrix.md'))
    expect(summary.moduleCount).toBe(4)
    expect(summary.modules.map((entry: { module: string }) => entry.module)).toEqual([
      'blackcat-analytics',
      'blackcat-auth',
      'blackcat-auth-js',
      'blackcat-core',
    ])
    expect(summary.corePrimitiveSummary).toMatchObject({
      module: 'blackcat-core',
      primitiveGroupCount: 2,
      testCount: 3,
    })
    expect(summary.riskSummary.total).toBe(4)
    expect(summary.riskSummary.severityCounts.high).toBe(2)
    expect(Number.isNaN(Date.parse(summary.generatedAt))).toBe(false)

    const markdown = readFileSync(join(root, 'kernel-migration', 'legacy-libs-matrix.md'), 'utf8')
    expect(markdown).toContain('# Legacy Migration Matrix')
    expect(markdown).toContain('- Module map: `kernel-migration/LEGACY_MODULE_MAP.md`')
    expect(markdown).toContain('| `blackcat-analytics` | `9f69f1d` | extracted | pending |')
    expect(markdown).toContain('| `blackcat-core` | `f1c3dc7` | extracted | 2 primitive groups, 3 tests |')
    expect(markdown).toContain('## Core primitive evidence')
    expect(markdown).toContain('| byte helpers |')
    expect(markdown).toContain('- high: 2')
    expect(markdown).toContain('- Total findings: 4')
  })

  it('supports custom paths and help output', () => {
    const root = seedWorkspace()
    seedCorePrimitiveMap(root)
    const manifestPath = join(root, 'kernel-migration', 'legacy-archive', 'MANIFEST.md')
    const outPath = join(root, 'kernel-migration', 'custom-matrix.md')

    const res = runMatrix(['--manifest', manifestPath, '--core-map', join(root, 'kernel-migration', 'core-primitive-map.json'), '--out', outPath], root)
    expect(res.status).toBe(0)
    expect(readFileSync(outPath, 'utf8')).toContain('| `blackcat-auth-js` | `ff46aa7` | extracted | pending |')
    expect(readFileSync(outPath, 'utf8')).toContain('| `blackcat-core` | `f1c3dc7` | extracted | 2 primitive groups, 3 tests |')
    expect(res.stdout).toContain('# Legacy Migration Matrix')

    const helpRes = runMatrix(['--help'], root)
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('build-legacy-migration-matrix.js')
    expect(helpRes.stdout).toContain('--risk <FILE>')
    expect(helpRes.stdout).toContain('--core-map <FILE>')
    expect(helpRes.stdout).toContain('--module-map <FILE>')
  })

  it('fails when an explicit core primitive map path is missing', () => {
    const root = seedWorkspace()
    const manifestPath = join(root, 'kernel-migration', 'legacy-archive', 'MANIFEST.md')
    const missingCoreMap = join(root, 'kernel-migration', 'missing-core-map.json')

    const res = runMatrix(['--manifest', manifestPath, '--core-map', missingCoreMap], root)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('missing-core-map.json')
  })
})
