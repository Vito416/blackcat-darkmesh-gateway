import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { collectLegacyModuleNames, runCli } from '../scripts/check-legacy-module-map-sync.js'

const scriptPath = fileURLToPath(new URL('../scripts/check-legacy-module-map-sync.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'legacy-module-sync-'))
  tempDirs.push(root)
  return root
}

function writeText(filePath: string, text: string) {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, text, 'utf8')
}

function seedDocs(root: string, docs: { plan: string; map: string; conditions: string }) {
  writeText(join(root, 'libs', 'legacy', 'MIGRATION_PLAN.md'), docs.plan)
  writeText(join(root, 'kernel-migration', 'LEGACY_MODULE_MAP.md'), docs.map)
  writeText(join(root, 'kernel-migration', 'LEGACY_DECOMMISSION_CONDITIONS.md'), docs.conditions)
}

function runCheck(root: string, args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

describe('check-legacy-module-map-sync.js', () => {
  it('collects module identifiers from markdown tables, bullets, and headings', () => {
    const text = [
      '# Legacy Snapshot -> Gateway Runtime Migration Plan',
      '',
      '| Module | Status |',
      '| --- | --- |',
      '| `blackcat-config` | `extracted` |',
      '',
      '### `blackcat-core` (current: `in progress`)',
      'Module: blackcat-crypto-js',
      'Module: blackcat-auth',
    ].join('\n')

    expect(collectLegacyModuleNames(text)).toEqual([
      'blackcat-auth',
      'blackcat-config',
      'blackcat-core',
      'blackcat-crypto-js',
    ])
  })

  it('passes when all three migration docs stay in sync', () => {
    const root = makeTempRoot()
    seedDocs(root, {
      plan: [
        '# Migration plan',
        '',
        '| Module | Status |',
        '| --- | --- |',
        '| `blackcat-config` | `extracted` |',
        '| `blackcat-core` | `in progress` |',
        '| `blackcat-auth` | `extracted` |',
        '',
      ].join('\n'),
      map: [
        '# Legacy module map',
        '',
        '| Module | Status |',
        '| --- | --- |',
        '| `blackcat-auth` | `extracted` |',
        '| `blackcat-config` | `extracted` |',
        '| `blackcat-core` | `in progress` |',
        '',
      ].join('\n'),
      conditions: [
        '# Legacy decommission conditions',
        '',
        '### `blackcat-core`',
        '- `blackcat-config`',
        '- `blackcat-auth`',
        '',
      ].join('\n'),
    })

    const result = runCheck(root, ['--json'])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const payload = JSON.parse(result.stdout)
    expect(payload.status).toBe('ok')
    expect(payload.mismatchCount).toBe(0)
    expect(payload.moduleCount).toBe(3)
    for (const doc of payload.documents) {
      expect(doc.missing).toEqual([])
      expect(doc.extra).toEqual([])
    }
  })

  it('reports missing and extra modules in non-strict mode', () => {
    const root = makeTempRoot()
    seedDocs(root, {
      plan: [
        '# Migration plan',
        '',
        '| Module | Status |',
        '| --- | --- |',
        '| `blackcat-config` | `extracted` |',
        '| `blackcat-core` | `in progress` |',
        '| `blackcat-auth` | `extracted` |',
        '',
      ].join('\n'),
      map: [
        '# Legacy module map',
        '',
        '| Module | Status |',
        '| --- | --- |',
        '| `blackcat-config` | `extracted` |',
        '| `blackcat-core` | `in progress` |',
        '| `blackcat-crypto-js` | `extracted` |',
        '',
      ].join('\n'),
      conditions: [
        '# Legacy decommission conditions',
        '',
        '### `blackcat-config`',
        '- `blackcat-auth`',
        '',
      ].join('\n'),
    })

    const result = runCheck(root, ['--json'])
    expect(result.status).toBe(0)

    const payload = JSON.parse(result.stdout)
    expect(payload.status).toBe('mismatch')
    expect(payload.mismatchCount).toBeGreaterThan(0)

    const plan = payload.documents.find((doc: { file: string }) => doc.file.includes('MIGRATION_PLAN'))
    const map = payload.documents.find((doc: { file: string }) => doc.file.includes('LEGACY_MODULE_MAP'))
    const conditions = payload.documents.find((doc: { file: string }) => doc.file.includes('LEGACY_DECOMMISSION_CONDITIONS'))

    expect(plan.missing).toEqual(['blackcat-crypto-js'])
    expect(plan.extra).toEqual(['blackcat-auth', 'blackcat-core'])
    expect(map.missing).toEqual(['blackcat-auth'])
    expect(map.extra).toEqual(['blackcat-core', 'blackcat-crypto-js'])
    expect(conditions.missing).toEqual(['blackcat-core', 'blackcat-crypto-js'])
    expect(conditions.extra).toEqual(['blackcat-auth'])
  })

  it('fails in strict mode when mismatches exist', () => {
    const root = makeTempRoot()
    seedDocs(root, {
      plan: '# plan\n| Module |\n| --- |\n| `blackcat-config` |\n',
      map: '# map\n| Module |\n| --- |\n| `blackcat-config` |\n| `blackcat-core` |\n',
      conditions: '# conditions\n### `blackcat-config`\n',
    })

    const result = runCheck(root, ['--strict'])
    expect(result.status).toBe(3)
    expect(result.stdout).toContain('Legacy Module Map Sync')
    expect(result.stdout).toContain('Missing in this file')
  })

  it('prints help text', () => {
    const result = runCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('LEGACY_DECOMMISSION_CONDITIONS')
  })
})
