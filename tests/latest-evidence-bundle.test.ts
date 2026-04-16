import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/latest-evidence-bundle.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeBundle(root: string, name: string, files: Record<string, string> = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'compare.txt'), files.compare ?? 'compare\n', 'utf8')
  writeFileSync(join(dir, 'attestation.json'), files.attestation ?? '{"ok":true}\n', 'utf8')
  writeFileSync(join(dir, 'manifest.json'), files.manifest ?? '{"ok":true}\n', 'utf8')
  return dir
}

function runLatest(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('latest-evidence-bundle.js', () => {
  it('prints help and exits cleanly', () => {
    const res = runLatest(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--root <DIR>')
  })

  it('selects the newest timestamped bundle and prints paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-root-'))
    tempDirs.push(root)
    const older = makeBundle(root, '2026-04-10T10-20-30Z-111111-aaaaaa')
    const newer = makeBundle(root, '2026-04-10T10-20-31Z-222222-bbbbbb')
    makeBundle(root, 'not-a-timestamp')

    const res = runLatest(['--root', root])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`bundleDir: ${newer}`)
    expect(res.stdout).toContain(`comparePath: ${join(newer, 'compare.txt')}`)
    expect(res.stdout).toContain(`attestationPath: ${join(newer, 'attestation.json')}`)
    expect(res.stdout).toContain(`manifestPath: ${join(newer, 'manifest.json')}`)
    expect(res.stdout).not.toContain(older)
  })

  it('emits json output with the selected bundle metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-root-json-'))
    tempDirs.push(root)
    const bundle = makeBundle(root, '2026-04-10T10-20-30Z-111111-aaaaaa')

    const res = runLatest(['--root', root, '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.root).toBe(root)
    expect(parsed.bundleDir).toBe(bundle)
    expect(parsed.comparePath).toBe(join(bundle, 'compare.txt'))
    expect(parsed.attestationPath).toBe(join(bundle, 'attestation.json'))
    expect(parsed.manifestPath).toBe(join(bundle, 'manifest.json'))
    expect(parsed.missingFiles).toEqual([])
  })

  it('fails with exit code 3 when no timestamped bundle exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-empty-'))
    tempDirs.push(root)

    const res = runLatest(['--root', root])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no timestamped evidence bundle found')
  })

  it('fails with exit code 3 when required files are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-evidence-missing-'))
    tempDirs.push(root)
    const bundle = join(root, '2026-04-10T10-20-30Z-111111-aaaaaa')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'compare.txt'), 'compare\n', 'utf8')

    const res = runLatest(['--root', root, '--require-files'])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('missing required file(s): attestation.json, manifest.json')
    expect(res.stdout).toBe('')
    expect(res.stderr).not.toContain(bundle)
  })

  it('returns a usage error when --root is missing', () => {
    const res = runLatest([])
    expect(res.status).toBe(64)
    expect(res.stderr).toContain('error: --root is required')
  })
})
