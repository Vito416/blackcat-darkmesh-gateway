import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { buildRateLimitSuggestion } from '../scripts/suggest-ratelimit-overrides.js'

const scriptPath = fileURLToPath(new URL('../scripts/suggest-ratelimit-overrides.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-rl-suggest-'))
  tempDirs.push(dir)
  return dir
}

function writeInput(data: unknown) {
  const dir = makeTempDir()
  const path = join(dir, 'input.json')
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return path
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('suggest-ratelimit-overrides.js', () => {
  it('prints help and exits cleanly', () => {
    const res = runCli(['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Usage:')
    expect(res.stdout).toContain('--input <FILE>')
  })

  it('produces profile-specific suggestions', () => {
    const routes = [
      { prefix: 'webhook', p95Rps: 18, blockedRate: 0.08, burstFactor: 1.4 },
      { prefix: 'inbox', p95Rps: 9, blockedRate: 0.03, burstFactor: 1.15 },
    ]

    const small = buildRateLimitSuggestion(routes, 'wedos_small')
    const medium = buildRateLimitSuggestion(routes, 'wedos_medium')
    const diskless = buildRateLimitSuggestion(routes, 'diskless')

    expect(small.suggestion).toBe('inbox=14,webhook=27')
    expect(medium.suggestion).toBe('inbox=16,webhook=31')
    expect(diskless.suggestion).toBe('inbox=14,webhook=26')
    expect(medium.entries[0].rationale).toContain('profile=wedos_medium')
    expect(medium.entries[1].rationale).toContain('profile=wedos_medium')
  })

  it('clamps values to the provided floor and ceiling', () => {
    const routes = [
      { prefix: 'alpha', p95Rps: 1, blockedRate: 0, burstFactor: 1 },
      { prefix: 'beta', p95Rps: 100, blockedRate: 1, burstFactor: 3 },
    ]

    const result = buildRateLimitSuggestion(routes, 'wedos_medium', { floor: 12, ceiling: 40 })
    expect(result.suggestion).toBe('alpha=12,beta=40')
    expect(result.entries[0].rationale).toContain('floor=12')
    expect(result.entries[0].rationale).toContain('final=12')
    expect(result.entries[1].rationale).toContain('ceiling=40')
    expect(result.entries[1].rationale).toContain('final=40')
  })

  it('fails closed on invalid schema from the CLI', () => {
    const input = writeInput([{ prefix: 'bad', p95Rps: -1, blockedRate: 0.1, burstFactor: 1.1 }])
    const res = runCli(['--input', input])
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('out-of-range p95Rps')
  })

  it('prints the deterministic override string and rationale lines', () => {
    const input = writeInput([
      { prefix: 'webhook', p95Rps: 20, blockedRate: 0.05, burstFactor: 1.25 },
      { prefix: 'inbox', p95Rps: 10, blockedRate: 0.01, burstFactor: 1.05 },
    ])

    const res = runCli(['--input', input, '--profile', 'wedos_medium'])
    expect(res.status).toBe(0)
    expect(res.stdout.split('\n')[0]).toBe('inbox=16,webhook=31')
    expect(res.stdout).toContain('- prefix=inbox')
    expect(res.stdout).toContain('- prefix=webhook')
  })
})
