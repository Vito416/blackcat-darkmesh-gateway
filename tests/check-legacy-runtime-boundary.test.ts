import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-legacy-runtime-boundary.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempSourceTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'legacy-runtime-boundary-'))
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

describe('check-legacy-runtime-boundary.js', () => {
  it('passes when runtime files have no legacy imports', () => {
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
    expect(res.stdout).toContain('# Legacy Runtime Boundary')
    expect(res.stdout).toContain('Findings: 0')
    expect(res.stdout).toContain('No forbidden legacy runtime imports found.')
  })

  it('reports direct forbidden imports with file and line', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/index.ts': [
        "import runtimeBridge from 'libs/legacy/runtime-bridge'",
        'export default runtimeBridge',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('Findings: 1')
    expect(res.stdout).toContain('libs/legacy/runtime-bridge')
    expect(res.stdout).toMatch(/runtime\/index\.ts:1/)
  })

  it('exits 3 in strict mode when findings are present', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/load.ts': [
        'export function loadLegacyBridge() {',
        "  return require('../../libs/legacy/runtime-bridge/index.js')",
        '}',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('Findings: 1')
    expect(res.stdout).toContain('libs/legacy/runtime-bridge/index.js')
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
