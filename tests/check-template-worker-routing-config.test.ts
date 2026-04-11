import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  assessTemplateWorkerRoutingConfig,
} from '../scripts/check-template-worker-routing-config.js'

const scriptPath = fileURLToPath(new URL('../scripts/check-template-worker-routing-config.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeTempJson(payload: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-template-routing-'))
  tempDirs.push(dir)
  const file = join(dir, 'payload.json')
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return file
}

function runValidator(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('check-template-worker-routing-config.js', () => {
  it('accepts a valid routing map with full token coverage', () => {
    const res = runValidator([
      '--url-map',
      JSON.stringify({
        alpha: 'https://alpha.example/routing',
        beta: 'http://beta.example/routing',
      }),
      '--token-map',
      JSON.stringify({
        alpha: 'token-alpha',
        beta: 'token-beta',
      }),
      '--json',
    ])

    expect(res.status).toBe(0)
    expect(res.stdout).toContain('"status": "complete"')
    expect(res.stdout).toContain('"urlMapCount": 2')
    expect(res.stdout).toContain('"missingTokenCount": 0')
    expect(res.stderr).toBe('')
  })

  it('rejects invalid JSON with exit code 3', () => {
    const res = runValidator(['--url-map', '{not-json}', '--json'])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('blocked:')
    expect(res.stderr).toContain('must be valid JSON')
  })

  it('rejects a token key that is missing from the url map', () => {
    const res = runValidator([
      '--url-map',
      JSON.stringify({
        alpha: 'https://alpha.example/routing',
      }),
      '--token-map',
      JSON.stringify({
        alpha: 'token-alpha',
        beta: 'token-beta',
      }),
    ])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('status: blocked')
    expect(res.stdout).toContain('token map key beta does not exist in url map')
  })

  it('returns pending in non-strict mode when token coverage is incomplete', () => {
    const res = runValidator([
      '--url-map',
      JSON.stringify({
        alpha: 'https://alpha.example/routing',
        beta: 'https://beta.example/routing',
      }),
      '--token-map',
      JSON.stringify({
        alpha: 'token-alpha',
      }),
    ])

    expect(res.status).toBe(0)
    expect(res.stdout).toContain('status: pending')
    expect(res.stdout).toContain('missing token coverage for: beta')
  })

  it('fails strict mode when token coverage is incomplete', () => {
    const res = runValidator([
      '--url-map',
      JSON.stringify({
        alpha: 'https://alpha.example/routing',
        beta: 'https://beta.example/routing',
      }),
      '--token-map',
      JSON.stringify({
        alpha: 'token-alpha',
      }),
      '--strict',
      '--json',
    ])

    expect(res.status).toBe(3)
    expect(res.stdout).toContain('"status": "blocked"')
    expect(res.stdout).toContain('missing token coverage for: beta')
  })

  it('exposes the pure assessor for pending mode without a token map', () => {
    const result = assessTemplateWorkerRoutingConfig({
      urlMap: { alpha: 'https://alpha.example/routing' },
      strict: false,
    })

    expect(result.status).toBe('pending')
    expect(result.warnings[0]).toContain('token map not provided')
  })

  it('prints help and exits cleanly', () => {
    const res = runValidator(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--url-map <json>')
  })
})
