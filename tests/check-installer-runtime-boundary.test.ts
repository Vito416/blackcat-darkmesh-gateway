import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-installer-runtime-boundary.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempSourceTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'installer-runtime-boundary-'))
  tempDirs.push(root)
  const srcRoot = join(root, 'src')

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(srcRoot, relativePath)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, `${contents}\n`, 'utf8')
  }

  return srcRoot
}

function runBoundaryCheck(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('check-installer-runtime-boundary.js', () => {
  it('passes when runtime files have no installer legacy imports', () => {
    const srcRoot = makeTempSourceTree({
      'index.ts': [
        "import { createHash } from 'node:crypto'",
        "import { readFile } from './runtime/io'",
        '',
        'export function bootstrap() {',
        "  return createHash('sha256').digest('hex')",
        '}',
      ].join('\n'),
      'runtime/io.ts': "export async function readFile() { return 'ok' }",
    })

    const res = runBoundaryCheck(['--root', srcRoot])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Installer Runtime Boundary')
    expect(res.stdout).toContain('Findings: 0')
    expect(res.stdout).toContain('No forbidden installer legacy imports found.')
  })

  it('reports forbidden installer imports in json mode', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/index.ts': [
        "import installer from '../../libs/legacy/blackcat-installer/src/Installer.php'",
        'export default installer',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot, '--json'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(() => JSON.parse(res.stdout)).not.toThrow()
    expect(res.stdout).toContain('blackcat-installer/src/Installer.php')
    expect(res.stdout).toContain('"findingCount": 1')
  })

  it('exits 3 in strict mode when findings are present', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/load.ts': [
        'export function loadInstallerBridge() {',
        "  return require('../../../libs/legacy/blackcat-installer/bin/installer')",
        '}',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('Findings: 1')
    expect(res.stdout).toContain('blackcat-installer/bin/installer')
    expect(res.stdout).toMatch(/runtime\/load\.ts:2/)
  })

  it('shows help text and usage errors', () => {
    const helpRes = runBoundaryCheck(['--help'])
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('Usage:')
    expect(helpRes.stdout).toContain('--root <dir>')

    const usageRes = runBoundaryCheck(['--root'])
    expect(usageRes.status).toBe(64)
    expect(usageRes.stderr).toContain('missing value for --root')
  })
})
