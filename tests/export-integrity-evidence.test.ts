import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  ATTEST_SCRIPT,
  COMPARE_SCRIPT,
  exportIntegrityEvidence,
  resolveTokenMode,
} from '../scripts/lib/export-integrity-evidence-core.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-evidence-'))
  tempDirs.push(dir)
  return dir
}

function fixedNow() {
  return new Date('2026-04-10T12:34:56.000Z')
}

function makeRunStub({
  compareStatus = 0,
  compareStdout = 'compare ok',
  compareStderr = '',
  attestStatus = 0,
  attestStdout = 'attest ok',
  attestStderr = '',
  writeAttestationArtifact = true,
}: {
  compareStatus?: number
  compareStdout?: string
  compareStderr?: string
  attestStatus?: number
  attestStdout?: string
  attestStderr?: string
  writeAttestationArtifact?: boolean
} = {}) {
  const calls: Array<{ scriptPath: string; args: string[]; env: Record<string, string> }> = []

  const runNodeScript = (scriptPath: string, scriptArgs: string[], extraEnv = {}) => {
    calls.push({ scriptPath, args: scriptArgs.slice(), env: { ...extraEnv } })

    if (scriptPath === ATTEST_SCRIPT && writeAttestationArtifact) {
      const outIndex = scriptArgs.indexOf('--out')
      if (outIndex >= 0 && scriptArgs[outIndex + 1]) {
        const outPath = scriptArgs[outIndex + 1]
        mkdirSync(dirname(outPath), { recursive: true })
        writeFileSync(
          outPath,
          `${JSON.stringify(
            {
              artifactType: 'gateway-integrity-attestation',
              scriptVersionTag: 'integrity-attestation-v1',
              generatedAt: '2026-04-10T12:34:56.000Z',
              gateways: [],
              comparedFields: [],
              summary: {
                mismatchCount: 0,
                invalidFieldCount: 0,
                gatewayCount: 2,
              },
              digest: 'sha256:stub',
            },
            null,
            2,
          )}\n`,
          'utf8',
        )
      }
    }

    return scriptPath === COMPARE_SCRIPT
      ? {
          command: `node ${scriptPath}`,
          status: compareStatus,
          signal: '',
          error: '',
          stdout: compareStdout,
          stderr: compareStderr,
        }
      : {
          command: `node ${scriptPath}`,
          status: attestStatus,
          signal: '',
          error: '',
          stdout: attestStdout,
          stderr: attestStderr,
        }
  }

  return { calls, runNodeScript }
}

function makeWriteSpy() {
  const writes = new Map<string, string>()
  const writeText = async (path: string, content: string) => {
    writes.set(path, content)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return { writes, writeText }
}

describe('export-integrity-evidence core', () => {
  it('resolves token modes for env fallback, shared token, and per-url tokens', () => {
    const urls = ['https://gw-a.example/', 'https://gw-b.example/']

    expect(resolveTokenMode({ tokens: [] }, urls, 'env-token')).toEqual({
      tokens: ['env-token', 'env-token'],
      tokenMode: 'env:GATEWAY_INTEGRITY_STATE_TOKEN',
      envToken: 'env-token',
    })
    expect(resolveTokenMode({ tokens: ['shared-token'] }, urls, '')).toEqual({
      tokens: ['shared-token', 'shared-token'],
      tokenMode: 'explicit:shared',
      envToken: '',
    })
    expect(resolveTokenMode({ tokens: ['token-a', 'token-b'] }, urls, '')).toEqual({
      tokens: ['token-a', 'token-b'],
      tokenMode: 'explicit:per-url',
      envToken: '',
    })
  })

  it('records compare failures in the manifest and bundle report', async () => {
    const outDir = makeTempDir()
    const { writes, writeText } = makeWriteSpy()
    const { runNodeScript, calls } = makeRunStub({
      compareStatus: 4,
      compareStdout: '',
      compareStderr: 'compare exploded',
    })

    const result = await exportIntegrityEvidence({
      urls: ['https://gw-a.example/', 'https://gw-b.example/'],
      args: { outDir, tokens: [], hmacEnv: '' },
      envToken: 'env-token',
      now: fixedNow,
      random: () => 0.123456,
      pid: 4321,
      runNodeScript,
      writeText,
      mkdir: async (path, options) => {
        mkdirSync(path, options)
      },
    })

    expect(result.exitCode).toBe(4)
    expect(result.manifest.status).toBe('failed')
    expect(result.manifest.compare).toMatchObject({ ok: false, exitCode: 4 })
    expect(result.manifest.attestation).toMatchObject({ ok: true, exitCode: 0 })
    expect(calls).toHaveLength(2)

    const compareReport = writes.get(result.compareLogPath)
    expect(compareReport).toContain('== compare-integrity-state ==')
    expect(compareReport).toContain('status: 4')
    expect(compareReport).toContain('compare exploded')

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      tool: 'scripts/export-integrity-evidence.js',
      status: 'failed',
      commandArgs: { tokenMode: 'env:GATEWAY_INTEGRITY_STATE_TOKEN', tokenCount: 0 },
    })
  })

  it('records attestation failures in the manifest and bundle report', async () => {
    const outDir = makeTempDir()
    const { writes, writeText } = makeWriteSpy()
    const { runNodeScript } = makeRunStub({
      attestStatus: 7,
      attestStdout: '',
      attestStderr: 'attestation exploded',
    })

    const result = await exportIntegrityEvidence({
      urls: ['https://gw-a.example/', 'https://gw-b.example/'],
      args: { outDir, tokens: ['token-a', 'token-b'], hmacEnv: 'GATEWAY_ATTESTATION_HMAC_KEY' },
      envToken: '',
      now: fixedNow,
      random: () => 0.654321,
      pid: 5678,
      runNodeScript,
      writeText,
      mkdir: async (path, options) => {
        mkdirSync(path, options)
      },
    })

    expect(result.exitCode).toBe(7)
    expect(result.manifest.status).toBe('failed')
    expect(result.manifest.compare).toMatchObject({ ok: true, exitCode: 0 })
    expect(result.manifest.attestation).toMatchObject({ ok: false, exitCode: 7 })

    const compareReport = writes.get(result.compareLogPath)
    expect(compareReport).toContain('== generate-integrity-attestation ==')
    expect(compareReport).toContain('status: 7')
    expect(compareReport).toContain('attestation exploded')

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      status: 'failed',
      commandArgs: { tokenMode: 'explicit:per-url', tokenCount: 2, hmacEnv: 'GATEWAY_ATTESTATION_HMAC_KEY' },
    })
  })

  it('writes the compare log, attestation artifact, and manifest on success', async () => {
    const outDir = makeTempDir()
    const { writes, writeText } = makeWriteSpy()
    const { runNodeScript, calls } = makeRunStub()

    const result = await exportIntegrityEvidence({
      urls: ['https://gw-a.example/', 'https://gw-b.example/'],
      args: { outDir, tokens: ['shared-token'], hmacEnv: '' },
      envToken: '',
      now: fixedNow,
      random: () => 0.5,
      pid: 9876,
      runNodeScript,
      writeText,
      mkdir: async (path, options) => {
        mkdirSync(path, options)
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.bundleDir).toBe(join(outDir, '2026-04-10T12-34-56Z-9876-7fffff'))
    expect(result.compareLogPath).toBe(join(result.bundleDir, 'compare.txt'))
    expect(result.attestationPath).toBe(join(result.bundleDir, 'attestation.json'))
    expect(result.manifestPath).toBe(join(result.bundleDir, 'manifest.json'))
    expect(calls.map((entry) => entry.scriptPath)).toEqual([COMPARE_SCRIPT, ATTEST_SCRIPT])
    expect(writes.has(result.compareLogPath)).toBe(true)
    expect(writes.has(result.manifestPath)).toBe(true)
    expect(readFileSync(result.attestationPath, 'utf8')).toContain('gateway-integrity-attestation')

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      tool: 'scripts/export-integrity-evidence.js',
      status: 'ok',
      baseDir: outDir,
      bundleDir: result.bundleDir,
      commandArgs: {
        outDir,
        urlCount: 2,
        tokenMode: 'explicit:shared',
        tokenCount: 1,
        hmacEnv: '',
      },
      files: {
        compareLog: 'compare.txt',
        attestation: 'attestation.json',
      },
      compare: {
        ok: true,
        exitCode: 0,
      },
      attestation: {
        ok: true,
        exitCode: 0,
      },
    })
  })
})
