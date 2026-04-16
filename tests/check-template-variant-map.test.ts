import { afterEach, describe, expect, it } from 'vitest'

import { ENV_VAR, assessTemplateVariantMap, runCli } from '../scripts/check-template-variant-map.js'

const envBackup = new Map<string, string | undefined>()

afterEach(() => {
  const keys = new Set([...envBackup.keys(), ENV_VAR])
  for (const key of keys) {
    const value = envBackup.get(key)
    if (typeof value === 'undefined') {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  envBackup.clear()
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

describe('check-template-variant-map.js', () => {
  it('accepts a valid variant map', () => {
    setEnv(JSON.stringify({
      alpha: { variant: 'signal', templateTxId: 'tx-a', manifestTxId: 'manifest-a' },
      beta: { variant: 'bastion', templateTxId: 'tx-b', manifestTxId: 'manifest-b' },
    }))

    const result = runCli(['--require-sites', 'alpha,beta', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('complete')
    expect(parsed.counts.providedCount).toBe(2)
  })

  it('returns pending without strict mode when env var is missing', () => {
    setEnv(undefined)
    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.status).toBe('pending')
    expect(parsed.warnings.join('\n')).toContain('is not set')
  })

  it('fails strict mode when env var is missing', () => {
    setEnv(undefined)
    const result = runCli(['--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.issues.join('\n')).toContain('is not set')
  })

  it('rejects unsupported variants', () => {
    setEnv(JSON.stringify({
      alpha: { variant: 'unknown', templateTxId: 'tx-a', manifestTxId: 'manifest-a' },
    }))

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.issues.join('\n')).toContain('unsupported variant')
  })

  it('supports custom allow list', () => {
    setEnv(JSON.stringify({
      alpha: { variant: 'custom', templateTxId: 'tx-a', manifestTxId: 'manifest-a' },
    }))

    const result = runCli(['--allow-variants', 'custom', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(0)
    expect(parsed.status).toBe('complete')
  })

  it('exposes pure assessor', () => {
    const result = assessTemplateVariantMap({
      variantMap: {
        alpha: { variant: 'signal', templateTxId: 'tx-a', manifestTxId: 'manifest-a' },
      },
      requireSites: ['alpha'],
      strict: true,
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('complete')
    expect(result.map).toEqual({
      alpha: {
        variant: 'signal',
        templateTxId: 'tx-a',
        manifestTxId: 'manifest-a',
      },
    })
  })
})
