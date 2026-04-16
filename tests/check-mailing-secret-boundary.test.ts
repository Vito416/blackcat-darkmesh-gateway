import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-mailing-secret-boundary.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempSourceTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'mailing-secret-boundary-'))
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

describe('check-mailing-secret-boundary.js', () => {
  it('passes when mailing runtime files do not read local secrets', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/mailing/queue.ts': [
        'export function queueMail() {',
        "  return { mode: 'public-safe' }",
        '}',
      ].join('\n'),
      'runtime/mailing/transport.ts': [
        'export function createMailTransport() {',
        "  return { send: async () => ({ ok: true, status: 202, outcome: 'success' as const }) }",
        '}',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Mailing Secret Boundary')
    expect(res.stdout).toContain('Findings: 0')
    expect(res.stdout).toContain('No local secret access found in mailing runtime files.')
  })

  it('reports process.env and import.meta.env access in mailing runtime files', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/mailing/transport.ts': [
        'export const smtpHost = process.env.SMTP_HOST',
        'export const clientSecret = import.meta.env.MAIL_SECRET',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot, '--json'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(() => JSON.parse(res.stdout)).not.toThrow()

    const report = JSON.parse(res.stdout)
    expect(report.status).toBe('issues-found')
    expect(report.findingCount).toBe(2)
    expect(report.findings).toHaveLength(2)
    expect(report.findings[0]).toMatchObject({
      line: 1,
      kind: 'property',
      expression: 'process.env',
    })
    expect(report.findings[0].file).toContain('src/runtime/mailing/transport.ts')
    expect(report.findings[1]).toMatchObject({
      line: 2,
      kind: 'property',
      expression: 'import.meta.env',
    })
    expect(report.findings[1].file).toContain('src/runtime/mailing/transport.ts')
  })

  it('exits 3 in strict mode when findings are present', () => {
    const srcRoot = makeTempSourceTree({
      'runtime/mailing/worker.ts': [
        'export const { env } = process',
      ].join('\n'),
    })

    const res = runBoundaryCheck(['--root', srcRoot, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('Findings: 1')
    expect(res.stdout).toContain('const { env } = process')
    expect(res.stdout).toMatch(/runtime\/mailing\/worker\.ts:1/)
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
