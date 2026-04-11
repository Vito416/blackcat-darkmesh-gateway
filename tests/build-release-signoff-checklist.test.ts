import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/build-release-signoff-checklist.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writePack(pack: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'release-signoff-'))
  tempDirs.push(dir)
  const packPath = join(dir, 'release-pack.json')
  writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
  return { dir, packPath }
}

function runChecklist(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('build-release-signoff-checklist.js', () => {
  it('renders a concise checklist for a ready pack', () => {
    const { packPath, dir } = writePack({
      release: '1.4.0',
      createdAt: '2026-04-11T10:20:30.000Z',
      status: 'ready',
      blockers: [],
      warnings: [],
      consistency: { status: 'pass', reason: 'all runs matched' },
      evidence: { status: 'pass', reason: 'latest bundle strict markers are ok' },
      aoGate: { status: 'pass', reason: 'all required AO dependency checks are closed' },
    })
    const outPath = join(dir, 'checklist.md')

    const res = runChecklist(['--pack', packPath, '--out', outPath])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('# Release Sign-off Checklist')
    expect(res.stdout).toContain('Pack status: `ready`')
    expect(res.stdout).toContain('AO gate: `pass` — all required AO dependency checks are closed')
    expect(res.stdout).toContain('## Blockers')
    expect(res.stdout).toContain('- [x] None')
    expect(readFileSync(outPath, 'utf8')).toBe(res.stdout)
  })

  it('includes blockers and warnings for a not-ready pack', () => {
    const { packPath } = writePack({
      release: '1.4.0',
      status: 'not-ready',
      blockers: ['consistency status=fail: 2 failure run(s)'],
      warnings: ['evidence bundle should be revalidated before approval'],
      consistency: { status: 'fail', reason: '2 failure run(s)' },
      evidence: { status: 'pass', reason: 'latest bundle strict markers are ok' },
      aoGate: { status: 'pass', reason: 'all required AO dependency checks are closed' },
    })

    const res = runChecklist(['--pack', packPath])

    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Pack status: `not-ready`')
    expect(res.stdout).toContain('## Blockers')
    expect(res.stdout).toContain('- [ ] consistency status=fail: 2 failure run(s)')
    expect(res.stdout).toContain('## Warnings')
    expect(res.stdout).toContain('- [ ] evidence bundle should be revalidated before approval')
  })

  it('exits 3 in strict mode when the pack is not ready', () => {
    const { packPath } = writePack({
      release: '1.4.0',
      status: 'not-ready',
      blockers: ['consistency status=fail: 2 failure run(s)'],
      warnings: ['evidence bundle should be revalidated before approval'],
      consistency: { status: 'fail', reason: '2 failure run(s)' },
      evidence: { status: 'pass', reason: 'latest bundle strict markers are ok' },
      aoGate: { status: 'pass', reason: 'all required AO dependency checks are closed' },
    })

    const res = runChecklist(['--pack', packPath, '--strict'])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('Pack status: `not-ready`')
    expect(res.stdout).toContain('## Checklist')
    expect(res.stderr).toBe('')
  })
})
