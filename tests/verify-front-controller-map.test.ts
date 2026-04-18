import { afterEach, describe, expect, it } from 'vitest'

import {
  ENV_VAR,
  parseTemplateMap,
  runCli,
  verifyTemplateMap,
} from '../scripts/verify-front-controller-map.js'

const backupEnv = new Map<string, string | undefined>()

afterEach(() => {
  const keys = new Set([...backupEnv.keys(), ENV_VAR])
  for (const key of keys) {
    const value = backupEnv.get(key)
    if (typeof value === 'undefined') delete process.env[key]
    else process.env[key] = value
  }
  backupEnv.clear()
})

function setMapEnv(value: string | undefined) {
  if (!backupEnv.has(ENV_VAR)) backupEnv.set(ENV_VAR, process.env[ENV_VAR])
  if (typeof value === 'undefined') delete process.env[ENV_VAR]
  else process.env[ENV_VAR] = value
}

async function runCliSilent(args: string[], options: Record<string, unknown> = {}) {
  let capturedStdout = ''
  let capturedStderr = ''
  const result = await runCli(args, {
    ...options,
    stdout: { write: (chunk: string) => { capturedStdout += chunk } },
    stderr: { write: (chunk: string) => { capturedStderr += chunk } },
  })
  return {
    ...result,
    stdout: capturedStdout,
    stderr: capturedStderr,
  }
}

describe('verify-front-controller-map.js', () => {
  it('parses map and verifies shape without network in skip-fetch mode', async () => {
    const raw = JSON.stringify({
      '*': {
        templateTxId: 'CZ6Wg4Ir2R_xFdMprOb1AZ-0H_AoE-nMLKpJjb8wDg8',
        templateSha256: '97196893aca0ad8f733ee2a8a3284aedd1360c0d42423be1b539740f0c993bb7',
      },
    })
    const parsed = parseTemplateMap(raw)
    expect(parsed.ok).toBe(true)

    const result = await verifyTemplateMap({
      templateMap: parsed.map,
      skipFetch: true,
      requireWildcard: true,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('complete')
    expect(result.issues).toEqual([])
  })

  it('returns pending when map source is missing without strict mode', async () => {
    setMapEnv(undefined)
    const result = await runCliSilent(['--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('pending')
    expect(payload.warnings.join('\n')).toContain(`${ENV_VAR} is not set`)
  })

  it('fails strict mode when map source is missing', async () => {
    setMapEnv(undefined)
    const result = await runCliSilent(['--strict', '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.issues.join('\n')).toContain(`${ENV_VAR} is not set`)
  })

  it('fails when wildcard is required but missing', async () => {
    setMapEnv(JSON.stringify({
      'gateway.blgateway.fun': {
        templateTxId: 'CZ6Wg4Ir2R_xFdMprOb1AZ-0H_AoE-nMLKpJjb8wDg8',
        templateSha256: '97196893aca0ad8f733ee2a8a3284aedd1360c0d42423be1b539740f0c993bb7',
      },
    }))

    const result = await runCliSilent(['--json', '--require-wildcard', '--skip-fetch'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.issues.join('\n')).toContain('wildcard')
  })

  it('fails on hash mismatch from upstream fetch', async () => {
    const raw = JSON.stringify({
      '*': {
        templateTxId: 'CZ6Wg4Ir2R_xFdMprOb1AZ-0H_AoE-nMLKpJjb8wDg8',
        templateSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })

    const result = await runCliSilent(['--json', '--map-json', raw], {
      fetchImpl: async () => new Response('<html>different</html>', { status: 200 }),
    })
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(3)
    expect(payload.status).toBe('blocked')
    expect(payload.issues.join('\n')).toContain('sha256 mismatch')
  })

  it('passes when fetched payload hash matches expected', async () => {
    const body = '<html><body>ok</body></html>'
    const raw = JSON.stringify({
      '*': {
        templateTxId: 'CZ6Wg4Ir2R_xFdMprOb1AZ-0H_AoE-nMLKpJjb8wDg8',
        templateSha256: '43906c1e3783f6cd8c0276141ea59b04ee0a176b818eea6b28fe178ac4978992',
      },
    })

    const result = await runCliSilent(['--json', '--map-json', raw], {
      fetchImpl: async () => new Response(body, { status: 200 }),
    })
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.status).toBe('complete')
    expect(payload.ok).toBe(true)
  })
})
