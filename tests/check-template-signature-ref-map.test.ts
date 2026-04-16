import { afterEach, describe, expect, it } from 'vitest'

import { parseRequireSites, runCli, validateSignatureRefMap } from '../scripts/check-template-signature-ref-map.js'

const ENV_VAR = 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP'

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

describe('check-template-signature-ref-map.js', () => {
  it('accepts a valid signature ref map', () => {
    setEnv(JSON.stringify({
      alpha: 'sig-alpha',
      beta: 'sig-beta',
    }))

    const result = runCli(['--require-sites', 'alpha,beta', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('complete')
    expect(parsed.counts.providedCount).toBe(2)
    expect(parsed.counts.missingCount).toBe(0)
    expect(parsed.warnings).toEqual([])
  })

  it('rejects malformed JSON', () => {
    setEnv('{not-json')

    const result = runCli(['--json'])

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('blocked:')
    expect(result.stderr).toContain('must be valid JSON')
  })

  it('rejects empty signature ref values', () => {
    setEnv(JSON.stringify({
      alpha: 'sig-alpha',
      beta: '   ',
    }))

    const result = runCli([])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Status: `blocked`')
    expect(result.stdout).toContain('signature ref map entry beta must be a non-empty string')
  })

  it('warns about missing required sites without strict mode', () => {
    setEnv(JSON.stringify({
      alpha: 'sig-alpha',
    }))

    const result = runCli(['--require-sites', 'alpha,beta', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.status).toBe('pending')
    expect(parsed.ok).toBe(false)
    expect(parsed.missingSites).toEqual(['beta'])
    expect(parsed.warnings[0]).toContain('missing signature refs for: beta')
  })

  it('fails strict mode when required sites are missing', () => {
    setEnv(JSON.stringify({
      alpha: 'sig-alpha',
    }))

    const result = runCli(['--require-sites', 'alpha,beta', '--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.ok).toBe(false)
    expect(parsed.issues[0]).toContain('missing signature refs for: beta')
  })

  it('exposes the pure validator and parser', () => {
    const parsedSites = parseRequireSites('alpha, beta, gamma')
    expect(parsedSites).toEqual(['alpha', 'beta', 'gamma'])

    const result = validateSignatureRefMap(
      {
        alpha: 'sig-alpha',
        beta: 'sig-beta',
      },
      {
        requiredSites: ['alpha'],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.status).toBe('complete')
    expect(result.map).toEqual({
      alpha: 'sig-alpha',
      beta: 'sig-beta',
    })
  })
})
