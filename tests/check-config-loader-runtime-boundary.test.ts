import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-config-loader-runtime-boundary.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempSourceTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'config-loader-runtime-boundary-'))
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

describe('check-config-loader-runtime-boundary.js', () => {
  it('passes when only the approved loader reads process.env', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/config/loader.ts': [
        'export function loadConfig() {',
        '  return process.env.RUNTIME_TOKEN',
        '}',
      ].join('\n'),
      'runtime/service.ts': [
        'export function useConfig(value: string) {',
        '  return value.trim()',
        '}',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Runtime Config Boundary')
    expect(res.stdout).toContain('Findings: 0')
    expect(res.stdout).toContain('No raw process.env usage found outside the approved loader file.')
  })

  it('reports raw process.env usage outside the approved loader file', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/config/loader.ts': [
        'export function loadConfig() {',
        '  return process.env.RUNTIME_TOKEN',
        '}',
      ].join('\n'),
      'runtime/worker.ts': [
        'export function bootstrap() {',
        '  return process.env.RUNTIME_TOKEN',
        '}',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('Findings: 1')
    expect(res.stdout).toContain('process.env')
    expect(res.stdout).toMatch(/runtime\/worker\.ts:2/)
    expect(res.stdout).not.toContain('runtime/config/loader.ts:2')
  })

  it('exits 3 in strict mode when findings are present', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/config/loader.ts': [
        'export function loadConfig() {',
        '  return process.env.RUNTIME_TOKEN',
        '}',
      ].join('\n'),
      'runtime/adapter.ts': [
        'export function bootstrap() {',
        '  return process["env"].RUNTIME_TOKEN',
        '}',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('Findings: 1')
    expect(res.stdout).toContain('process["env"]')
    expect(res.stdout).toMatch(/runtime\/adapter\.ts:2/)
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
