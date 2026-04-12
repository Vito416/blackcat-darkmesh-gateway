import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, scanRetiredPathReferences } from '../scripts/check-retired-path-references.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'retired-path-check-'))
  tempDirs.push(root)
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{\"name\":\"tmp\"}\n', 'utf8')
  return root
}

describe('check-retired-path-references.js', () => {
  it('passes when no retired references exist in default targets', () => {
    const root = makeTempRepo()
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: CI\n', 'utf8')
    writeFileSync(join(root, 'scripts/run.js'), 'console.log("ok")\n', 'utf8')

    const summary = scanRetiredPathReferences({ root })
    expect(summary.findingCount).toBe(0)
    expect(summary.status).toBe('pass')
  })

  it('finds retired kernel-migration path references', () => {
    const root = makeTempRepo()
    writeFileSync(
      join(root, '.github/workflows/ci.yml'),
      'run: npm run ops:validate-final-migration-summary -- --file kernel-migration/FINAL_MIGRATION_SUMMARY.md\n',
      'utf8',
    )

    const summary = scanRetiredPathReferences({ root })
    expect(summary.findingCount).toBe(1)
    expect(summary.findings[0]?.retiredPath).toBe('kernel-migration/')
  })

  it('returns strict non-zero when findings exist', () => {
    const root = makeTempRepo()
    writeFileSync(
      join(root, 'scripts/example.js'),
      'const p = "security/crypto-manifests/contexts/core.json"\n',
      'utf8',
    )

    const res = runCli(['--root', root, '--strict', '--json'])
    expect(res.exitCode).toBe(3)
    const payload = JSON.parse(res.stdout)
    expect(payload.findingCount).toBe(1)
    expect(payload.findings[0].retiredPath).toBe('security/crypto-manifests/')
  })
})
