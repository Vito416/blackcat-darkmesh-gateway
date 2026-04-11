import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/check-release-readiness.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writePack(pack: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'release-readiness-'))
  tempDirs.push(dir)
  const packPath = join(dir, 'release-evidence-pack.json')
  writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
  return packPath
}

function runCheck(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('check-release-readiness.js', () => {
  it('prints ready status in human mode', () => {
    const packPath = writePack({
      release: '1.4.0',
      status: 'ready',
      blockers: [],
      warnings: [],
    })

    const res = runCheck(['--pack', packPath])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Release Readiness')
    expect(res.stdout).toContain('Release: `1.4.0`')
    expect(res.stdout).toContain('Status: `ready`')
    expect(res.stdout).toContain('Blockers: 0')
    expect(res.stdout).toContain('Warnings: 0')
  })

  it('prints warning status in human mode when there are warnings but no blockers', () => {
    const packPath = writePack({
      release: '1.4.0',
      status: 'warning',
      blockers: [],
      warnings: ['consistency summary should be reviewed'],
    })

    const res = runCheck(['--pack', packPath])

    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Status: `warning`')
    expect(res.stdout).toContain('Blockers: 0')
    expect(res.stdout).toContain('Warnings: 1')
    expect(res.stdout).toContain('## Warnings')
    expect(res.stdout).toContain('- consistency summary should be reviewed')
  })

  it('prints blocked status and exits 3 when blockers are present', () => {
    const packPath = writePack({
      release: '1.4.0',
      status: 'blocked',
      blockers: ['consistency status=fail: 2 failure run(s)'],
      warnings: ['evidence bundle should be revalidated before approval'],
    })

    const res = runCheck(['--pack', packPath])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('Status: `blocked`')
    expect(res.stdout).toContain('Blockers: 1')
    expect(res.stdout).toContain('Warnings: 1')
    expect(res.stdout).toContain('## Blockers')
    expect(res.stdout).toContain('- consistency status=fail: 2 failure run(s)')
  })

  it('exits 3 in strict mode when the pack is not ready', () => {
    const packPath = writePack({
      release: '1.4.0',
      status: 'warning',
      blockers: [],
      warnings: ['evidence bundle should be revalidated before approval'],
    })

    const res = runCheck(['--pack', packPath, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('Status: `warning`')
    expect(res.stderr).toBe('')
  })

  it('prints structured JSON only with --json', () => {
    const packPath = writePack({
      release: '1.4.0',
      status: 'warning',
      blockers: [],
      warnings: ['evidence bundle should be revalidated before approval'],
    })

    const res = runCheck(['--pack', packPath, '--json'])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(JSON.parse(res.stdout)).toEqual({
      status: 'warning',
      blockerCount: 0,
      warningCount: 1,
      release: '1.4.0',
    })
    expect(res.stdout.trim().startsWith('{')).toBe(true)
    expect(res.stdout.trim().endsWith('}')).toBe(true)
  })

  it('shows help and rejects missing pack as a usage error', () => {
    const helpRes = runCheck(['--help'])
    expect(helpRes.status).toBe(0)
    expect(helpRes.stdout).toContain('Usage:')
    expect(helpRes.stdout).toContain('--pack <path>')

    const missingRes = runCheck(['--strict'])
    expect(missingRes.status).toBe(64)
    expect(missingRes.stderr).toContain('--pack is required')
  })
})
