import { afterEach, describe, expect, it } from 'vitest'

import { ENV_VARS, inspectForgetForwardConfig, parseAbsoluteHttpUrl, runCli } from '../scripts/check-forget-forward-config.js'

const envBackup = new Map<string, string | undefined>()

afterEach(() => {
  const keys = new Set([...envBackup.keys(), ENV_VARS.url, ENV_VARS.token, ENV_VARS.timeoutMs])
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

describe('check-forget-forward-config.js', () => {
  it('accepts a complete forget-forward config', () => {
    setEnv(ENV_VARS.url, 'https://worker.example/cache/forget')
    setEnv(ENV_VARS.token, 'forward-secret')
    setEnv(ENV_VARS.timeoutMs, '5000')

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('complete')
    expect(parsed.values.url).toBe('https://worker.example/cache/forget')
    expect(parsed.values.timeoutMs).toBe(5000)
    expect(parsed.warnings).toEqual([])
  })

  it('reports pending when the forget-forward URL is missing', () => {
    setEnv(ENV_VARS.token, 'forward-secret')
    setEnv(ENV_VARS.timeoutMs, '3000')

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(parsed.status).toBe('pending')
    expect(parsed.ok).toBe(false)
    expect(parsed.warnings).toContain('forget-forward relay is disabled because the URL is not set')
  })

  it('fails strict mode when the URL is missing', () => {
    setEnv(ENV_VARS.token, 'forward-secret')

    const result = runCli(['--strict', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('pending')
    expect(parsed.ok).toBe(false)
  })

  it('rejects malformed URLs', () => {
    setEnv(ENV_VARS.url, 'not-a-url')

    const result = runCli([])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Status: `blocked`')
    expect(result.stdout).toContain('must be an absolute http(s) URL')
  })

  it('rejects blank bearer tokens and out-of-range timeouts', () => {
    setEnv(ENV_VARS.url, 'https://worker.example/cache/forget')
    setEnv(ENV_VARS.token, '   ')
    setEnv(ENV_VARS.timeoutMs, '99')

    const result = runCli(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(parsed.status).toBe('blocked')
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        'GATEWAY_FORGET_FORWARD_TOKEN must not be blank when set',
        'GATEWAY_FORGET_FORWARD_TIMEOUT_MS must be between 100 and 30000 ms',
      ]),
    )
  })

  it('parses absolute http and https URLs', () => {
    expect(parseAbsoluteHttpUrl('https://worker.example/cache/forget').ok).toBe(true)
    expect(parseAbsoluteHttpUrl('http://worker.example/cache/forget').ok).toBe(true)
    expect(parseAbsoluteHttpUrl('/relative/path').ok).toBe(false)
  })

  it('exposes the pure inspector for missing config', () => {
    const result = inspectForgetForwardConfig({})

    expect(result.status).toBe('pending')
    expect(result.ok).toBe(false)
    expect(result.present.url).toBe(false)
    expect(result.values.timeoutMs).toBe(3000)
  })
})
