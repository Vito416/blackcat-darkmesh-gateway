import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENV_VAR, runCli } from '../scripts/build-template-variant-fallback-map.js'

const envBackup = new Map<string, string | undefined>()
const tempDirs: string[] = []

afterEach(() => {
  const envKeys = new Set([...envBackup.keys(), ENV_VAR])
  for (const key of envKeys) {
    const value = envBackup.get(key)
    if (typeof value === 'undefined') {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  envBackup.clear()

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function setEnv(value: string | undefined) {
  if (!envBackup.has(ENV_VAR)) {
    envBackup.set(ENV_VAR, process.env[ENV_VAR])
  }
  if (typeof value === 'undefined') {
    delete process.env[ENV_VAR]
  } else {
    process.env[ENV_VAR] = value
  }
}

function makeMapFile(value: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'variant-fallback-map-'))
  tempDirs.push(dir)
  const file = join(dir, 'template-variant-map.json')
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return file
}

describe('build-template-variant-fallback-map.js', () => {
  it('rebuilds all sites to the fallback variant and txids', () => {
    setEnv(JSON.stringify({
      alpha: { variant: 'signal', templateTxId: 'template-old-a', manifestTxId: 'manifest-old-a' },
      beta: { variant: 'bastion', templateTxId: 'template-old-b', manifestTxId: 'manifest-old-b' },
    }))

    const result = runCli([
      '--fallback-variant',
      'safe',
      '--template-txid',
      'template-safe',
      '--manifest-txid',
      'manifest-safe',
    ])

    const parsed = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(0)
    expect(parsed).toEqual({
      alpha: { variant: 'safe', templateTxId: 'template-safe', manifestTxId: 'manifest-safe' },
      beta: { variant: 'safe', templateTxId: 'template-safe', manifestTxId: 'manifest-safe' },
    })
  })

  it('updates only selected sites when --sites is provided', () => {
    const file = makeMapFile({
      alpha: { variant: 'signal', templateTxId: 'template-old-a', manifestTxId: 'manifest-old-a' },
      beta: { variant: 'bastion', templateTxId: 'template-old-b', manifestTxId: 'manifest-old-b' },
    })

    const result = runCli([
      '--file',
      file,
      '--fallback-variant',
      'safe',
      '--template-txid',
      'template-safe',
      '--manifest-txid',
      'manifest-safe',
      '--sites',
      'alpha',
      '--json',
    ])

    const parsed = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(0)
    expect(parsed.selectedSites).toEqual(['alpha'])
    expect(parsed.map.alpha).toEqual({
      variant: 'safe',
      templateTxId: 'template-safe',
      manifestTxId: 'manifest-safe',
    })
    expect(parsed.map.beta).toEqual({
      variant: 'bastion',
      templateTxId: 'template-old-b',
      manifestTxId: 'manifest-old-b',
    })
  })

  it('fails when --sites includes unknown site keys', () => {
    setEnv(JSON.stringify({
      alpha: { variant: 'signal', templateTxId: 'template-old-a', manifestTxId: 'manifest-old-a' },
    }))

    const result = runCli(['--fallback-variant', 'safe', '--sites', 'alpha,missing-site'])

    expect(result.exitCode).toBe(64)
    expect(result.stderr).toContain('unknown site(s) in --sites')
    expect(result.stderr).toContain('missing-site')
  })

  it('requires --fallback-variant', () => {
    setEnv(JSON.stringify({
      alpha: { variant: 'signal', templateTxId: 'template-old-a', manifestTxId: 'manifest-old-a' },
    }))

    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stderr).toContain('--fallback-variant is required')
  })
})
