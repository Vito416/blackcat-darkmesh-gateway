import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from '../scripts/validate-release-drill-manifest.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'release-drill-manifest-'))
  tempDirs.push(dir)
  const file = join(dir, 'manifest.json')
  writeFileSync(file, text, 'utf8')
  return file
}

function writeManifest(manifest: unknown) {
  return makeTempFile(`${JSON.stringify(manifest, null, 2)}\n`)
}

function baseManifest() {
  return {
    createdAt: '2026-04-11T12:00:00.000Z',
    drillDir: './artifacts/release-drill-2026-04-11',
    artifacts: [
      {
        path: 'release-evidence-pack.json',
        sizeBytes: 42,
        sha256: 'a'.repeat(64),
      },
      {
        path: 'release-signoff-checklist.md',
        sizeBytes: 9,
        sha256: 'b'.repeat(64),
      },
    ],
  }
}

describe('validate-release-drill-manifest.js', () => {
  it('accepts a valid release drill manifest', () => {
    const file = writeManifest(baseManifest())
    const result = runCli(['--file', file])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`valid release drill manifest: ${file}`)
    expect(result.stderr).toBe('')
  })

  it.each([
    {
      name: 'invalid sha256',
      manifest: {
        ...baseManifest(),
        artifacts: [
          {
            path: 'release-evidence-pack.json',
            sizeBytes: 42,
            sha256: 'not-a-sha256',
          },
        ],
      },
      message: 'artifacts[1].sha256 must be a 64-character hex string',
    },
    {
      name: 'invalid shape',
      manifest: {
        ...baseManifest(),
        artifacts: [
          {
            path: 123,
            sizeBytes: 42,
            sha256: 'a'.repeat(64),
          },
        ],
      },
      message: 'artifacts[1].path must be a string',
    },
  ])('rejects $name with exit code 3', ({ manifest, message }) => {
    const file = writeManifest(manifest)
    const result = runCli(['--file', file])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('invalid release drill manifest:')
    expect(result.stdout).toContain(message)
    expect(result.stderr).toBe('')
  })

  it('rejects duplicate artifact paths in strict mode', () => {
    const file = writeManifest({
      ...baseManifest(),
      artifacts: [
        {
          path: 'shared-artifact.json',
          sizeBytes: 42,
          sha256: 'a'.repeat(64),
        },
        {
          path: 'shared-artifact.json',
          sizeBytes: 9,
          sha256: 'b'.repeat(64),
        },
      ],
    })
    const result = runCli(['--file', file, '--strict'])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('invalid release drill manifest:')
    expect(result.stdout).toContain('artifacts[2].path must be unique in --strict mode')
    expect(result.stderr).toBe('')
  })

  it('returns a usage error when --file is missing', () => {
    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: --file is required')
  })
})
