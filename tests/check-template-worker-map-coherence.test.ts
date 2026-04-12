import { afterEach, describe, expect, it } from 'vitest'

import { ENV_VARS, assessTemplateWorkerMapCoherence, parseRequireSites, runCli } from '../scripts/check-template-worker-map-coherence.js'

const envBackup = new Map<string, string | undefined>()

afterEach(() => {
  const keys = new Set([...envBackup.keys(), ENV_VARS.urlMap, ENV_VARS.tokenMap, ENV_VARS.signatureRefMap])
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

function setEnv(key: string, value: string | undefined) {
  if (!envBackup.has(key)) {
    envBackup.set(key, process.env[key])
  }
  if (typeof value === 'undefined') {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('check-template-worker-map-coherence.js', () => {
  it('accepts a fully coherent map set', () => {
    setEnv(
      ENV_VARS.urlMap,
      JSON.stringify({
        alpha: 'https://alpha.example/sign',
        beta: 'http://beta.example/sign',
      }),
    )
    setEnv(
      ENV_VARS.tokenMap,
      JSON.stringify({
        alpha: 'token-alpha',
        beta: 'token-beta',
      }),
    )
    setEnv(
      ENV_VARS.signatureRefMap,
      JSON.stringify({
        alpha: 'sig-alpha',
        beta: 'sig-beta',
      }),
    )

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('complete')
    expect(parsed.counts.urlMapCount).toBe(2)
    expect(parsed.counts.missingTokenCount).toBe(0)
    expect(parsed.counts.missingSignatureRefCount).toBe(0)
    expect(parsed.warnings).toEqual([])
  })

  it('reports pending when token and signature maps are missing', () => {
    setEnv(
      ENV_VARS.urlMap,
      JSON.stringify({
        alpha: 'https://alpha.example/sign',
        beta: 'https://beta.example/sign',
      }),
    )

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.status).toBe('pending')
    expect(parsed.ok).toBe(false)
    expect(parsed.counts.missingTokenCount).toBe(2)
    expect(parsed.counts.missingSignatureRefCount).toBe(2)
    expect(parsed.warnings.join('\n')).toContain('missing token map entries for: alpha, beta')
    expect(parsed.warnings.join('\n')).toContain('missing signature-ref map entries for: alpha, beta')
  })

  it('fails strict mode when the URL map is missing', () => {
    const result = runCli(['--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.ok).toBe(false)
    expect(parsed.issues.join('\n')).toContain('GATEWAY_TEMPLATE_WORKER_URL_MAP is not set')
  })

  it('blocks strict mode when required URL sites are missing', () => {
    setEnv(
      ENV_VARS.urlMap,
      JSON.stringify({
        alpha: 'https://alpha.example/sign',
      }),
    )

    const result = runCli(['--require-sites', 'alpha,beta', '--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.ok).toBe(false)
    expect(parsed.issues.join('\n')).toContain('missing required site entries from --require-sites for: beta')
  })

  it('blocks extra token and signature keys that do not exist in the URL map', () => {
    setEnv(
      ENV_VARS.urlMap,
      JSON.stringify({
        alpha: 'https://alpha.example/sign',
      }),
    )
    setEnv(
      ENV_VARS.tokenMap,
      JSON.stringify({
        alpha: 'token-alpha',
        beta: 'token-beta',
      }),
    )
    setEnv(
      ENV_VARS.signatureRefMap,
      JSON.stringify({
        alpha: 'sig-alpha',
        gamma: 'sig-gamma',
      }),
    )

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.issues.join('\n')).toContain('token map contains keys not present in URL map: beta')
    expect(parsed.issues.join('\n')).toContain('signature-ref map contains keys not present in URL map: gamma')
  })

  it('promotes missing coverage to blockers when require flags are set', () => {
    setEnv(
      ENV_VARS.urlMap,
      JSON.stringify({
        alpha: 'https://alpha.example/sign',
        beta: 'https://beta.example/sign',
      }),
    )
    setEnv(
      ENV_VARS.tokenMap,
      JSON.stringify({
        alpha: 'token-alpha',
      }),
    )
    setEnv(
      ENV_VARS.signatureRefMap,
      JSON.stringify({
        alpha: 'sig-alpha',
      }),
    )

    const result = runCli(['--require-token-map', '--require-signature-map', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.ok).toBe(false)
    expect(parsed.issues.join('\n')).toContain('missing token map entries for: beta')
    expect(parsed.issues.join('\n')).toContain('missing signature-ref map entries for: beta')
  })

  it('fails malformed JSON immediately', () => {
    setEnv(ENV_VARS.urlMap, '{not-json')

    const result = runCli(['--json'])

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('blocked:')
    expect(result.stderr).toContain('must be valid JSON')
  })

  it('exposes the pure assessor and parser helpers', () => {
    expect(parseRequireSites('alpha, beta, alpha , gamma')).toEqual(['alpha', 'beta', 'gamma'])

    const result = assessTemplateWorkerMapCoherence({
      urlMap: { alpha: 'https://alpha.example/sign' },
      tokenMap: { alpha: 'token-alpha' },
      signatureRefMap: { alpha: 'sig-alpha' },
      requireSites: ['alpha'],
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('complete')
    expect(result.maps.url).toEqual({ alpha: 'https://alpha.example/sign' })
  })
})
