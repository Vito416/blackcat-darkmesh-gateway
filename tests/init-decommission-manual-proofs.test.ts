import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_JSON_OUT, DEFAULT_MD_OUT, REQUIRED_PROOF_DEFINITIONS, runCli } from '../scripts/init-decommission-manual-proofs.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'init-manual-proofs-'))
  tempDirs.push(dir)
  return dir
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('init-decommission-manual-proofs.js', () => {
  it('generates the json and markdown scaffold with default output paths', async () => {
    const dir = makeTempDir()

    const result = await runCli(['--dir', dir])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const jsonPath = join(dir, DEFAULT_JSON_OUT)
    const mdPath = join(dir, DEFAULT_MD_OUT)
    const json = readJson(jsonPath)
    const md = readFileSync(mdPath, 'utf8')

    expect(result.stdout).toContain(jsonPath)
    expect(result.stdout).toContain(mdPath)
    expect(json.status).toBe('pending')
    expect(json.manualProofs).toHaveLength(REQUIRED_PROOF_DEFINITIONS.length)
    expect(json.manualProofs.map((entry: { key: string }) => entry.key)).toEqual(
      REQUIRED_PROOF_DEFINITIONS.map((entry) => entry.key),
    )
    expect(json.manualProofs.every((entry: { link: string }) => entry.link === '')).toBe(true)
    expect(md).toContain('# Decommission Manual Proof Checklist')
    expect(md).toContain('- [ ] Recovery drill proof:')
    expect(md).toContain('https://example.invalid/recovery-drill-proof')
  })

  it('does not overwrite existing files without --force', async () => {
    const dir = makeTempDir()
    const jsonPath = join(dir, DEFAULT_JSON_OUT)
    const mdPath = join(dir, DEFAULT_MD_OUT)
    writeFileSync(jsonPath, '{"existing":true}\n', 'utf8')
    writeFileSync(mdPath, '# existing\n', 'utf8')

    const result = await runCli(['--dir', dir])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('refusing to overwrite existing file')
    expect(readFileSync(jsonPath, 'utf8')).toBe('{"existing":true}\n')
    expect(readFileSync(mdPath, 'utf8')).toBe('# existing\n')
  })

  it('overwrites existing files when --force is provided', async () => {
    const dir = makeTempDir()
    const jsonPath = join(dir, DEFAULT_JSON_OUT)
    const mdPath = join(dir, DEFAULT_MD_OUT)
    writeFileSync(jsonPath, '{"existing":true}\n', 'utf8')
    writeFileSync(mdPath, '# existing\n', 'utf8')

    const result = await runCli(['--dir', dir, '--force'])

    expect(result.exitCode).toBe(0)
    const json = readJson(jsonPath)
    const md = readFileSync(mdPath, 'utf8')

    expect(json.manualProofs).toHaveLength(REQUIRED_PROOF_DEFINITIONS.length)
    expect(json.manualProofs[0].label).toBe('Recovery drill proof')
    expect(md).toContain('## Required proofs')
    expect(md).toContain('- [ ] Approvals / sign-off:')
  })

  it('returns usage errors for missing directory arguments', async () => {
    const result = await runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stderr).toContain('--dir is required')
  })
})
