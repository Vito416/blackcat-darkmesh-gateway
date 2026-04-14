import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from '../scripts/validate-wedos-readiness.js'

const tempDirs: string[] = []
const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempEnvFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'wedos-readiness-'))
  tempDirs.push(dir)
  const file = join(dir, 'envfile')
  writeFileSync(file, contents, 'utf8')
  return file
}

function baseEnv(profile: 'wedos_small' | 'wedos_medium' | 'diskless') {
  const common = {
    GATEWAY_RESOURCE_PROFILE: profile,
    AO_INTEGRITY_FETCH_TIMEOUT_MS: profile === 'wedos_medium' ? '5000' : '4000',
    AO_INTEGRITY_FETCH_RETRY_ATTEMPTS: profile === 'wedos_medium' ? '3' : '2',
    AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS: profile === 'wedos_medium' ? '100' : '75',
    AO_INTEGRITY_FETCH_RETRY_JITTER_MS: '25',
    GATEWAY_CACHE_TTL_MS: profile === 'wedos_medium' ? '300000' : '180000',
    GATEWAY_CACHE_MAX_ENTRY_BYTES: profile === 'wedos_medium' ? '262144' : '131072',
    GATEWAY_CACHE_MAX_ENTRIES: profile === 'wedos_medium' ? '256' : '128',
    GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT: profile === 'wedos_medium' ? '64' : '32',
    GATEWAY_CACHE_ADMISSION_MODE: 'reject',
    GATEWAY_RL_WINDOW_MS: '60000',
    GATEWAY_RL_MAX: profile === 'wedos_medium' ? '120' : '80',
    GATEWAY_RL_MAX_BUCKETS: profile === 'wedos_medium' ? '10000' : '3000',
    GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS: profile === 'wedos_medium' ? '86400' : '43200',
    GATEWAY_TEMPLATE_ALLOW_MUTATIONS: '0',
    GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST:
      'ao-read.example.com,ao-write.example.com,worker-alpha.example.com,worker-beta.example.com',
    GATEWAY_SITE_ID_BY_HOST_MAP: JSON.stringify({
      'gateway.example': 'site-alpha',
      'store.example': 'site-beta',
    }),
    GATEWAY_TEMPLATE_WORKER_URL_MAP: JSON.stringify({
      'site-alpha': 'https://worker-alpha.example.com/sign',
      'site-beta': 'https://worker-beta.example.com/sign',
    }),
    GATEWAY_TEMPLATE_WORKER_TOKEN_MAP: JSON.stringify({
      'site-alpha': 'worker-token-alpha',
      'site-beta': 'worker-token-beta',
    }),
  }

  if (profile === 'wedos_medium') {
    return {
      ...common,
      GATEWAY_RL_MAX_OVERRIDES: 'inbox=80,webhook=240,template=120',
    }
  }

  if (profile === 'diskless') {
    return {
      ...common,
      GATEWAY_INTEGRITY_CHECKPOINT_MODE: 'diskless',
      GATEWAY_INTEGRITY_DISKLESS: '1',
    }
  }

  return common
}

describe('validate-wedos-readiness.js', () => {
  it('passes wedos_small when all required knobs are within budget', () => {
    const result = runCli(['--profile', 'wedos_small'], { env: baseEnv('wedos_small') })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# Hosting Readiness')
    expect(result.stdout).toContain('Profile: `wedos_small`')
    expect(result.stdout).toContain('Status: `pass`')
    expect(result.stderr).toBe('')
  })

  it('warns on wedos_medium when the recommended override map is missing', () => {
    const env = baseEnv('wedos_medium')
    delete env.GATEWAY_RL_MAX_OVERRIDES

    const result = runCli(['--profile', 'wedos_medium'], { env })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Status: `warn`')
    expect(result.stdout).toContain('GATEWAY_RL_MAX_OVERRIDES is not set for balanced')
    expect(result.stdout).toContain('Set GATEWAY_RL_MAX_OVERRIDES=inbox=80,webhook=240,template=120')
  })

  it('fails diskless readiness when checkpoint mode is not diskless in strict mode', () => {
    const env = baseEnv('diskless')
    delete env.GATEWAY_INTEGRITY_CHECKPOINT_MODE
    delete env.GATEWAY_INTEGRITY_DISKLESS

    const result = runCli(['--profile', 'diskless', '--strict'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Status: `fail`')
    expect(result.stdout).toContain('diskless profile requires diskless checkpoint handling')
    expect(result.stdout).toContain('Set GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless or GATEWAY_INTEGRITY_DISKLESS=1.')
  })

  it('rejects out-of-budget numeric knobs', () => {
    const env = baseEnv('wedos_small')
    env.AO_INTEGRITY_FETCH_TIMEOUT_MS = '9001'

    const result = runCli(['--profile', 'wedos_small'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('AO_INTEGRITY_FETCH_TIMEOUT_MS is too large for constrained-small (found 9001)')
    expect(result.stdout).toContain('Lower AO_INTEGRITY_FETCH_TIMEOUT_MS to <= 4000.')
  })

  it('loads env values from --env-file and prints JSON when requested', () => {
    const envFile = makeTempEnvFile([
      '# Hosting config',
      'export GATEWAY_RESOURCE_PROFILE="wedos_small"',
      'AO_INTEGRITY_FETCH_TIMEOUT_MS=4000',
      'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS=2',
      'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS=75',
      'AO_INTEGRITY_FETCH_RETRY_JITTER_MS=25',
      'GATEWAY_CACHE_TTL_MS=180000',
      'GATEWAY_CACHE_MAX_ENTRY_BYTES=131072',
      'GATEWAY_CACHE_MAX_ENTRIES=128',
      'GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT=32',
      'GATEWAY_CACHE_ADMISSION_MODE=reject',
      'GATEWAY_RL_WINDOW_MS=60000',
      'GATEWAY_RL_MAX=80',
      'GATEWAY_RL_MAX_BUCKETS=3000',
      'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS=43200',
      'GATEWAY_TEMPLATE_ALLOW_MUTATIONS=0',
      'GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST=ao-read.example.com,ao-write.example.com,worker-alpha.example.com,worker-beta.example.com',
      `GATEWAY_SITE_ID_BY_HOST_MAP='${JSON.stringify({ 'gateway.example': 'site-alpha' })}'`,
      `GATEWAY_TEMPLATE_WORKER_URL_MAP='${JSON.stringify({ 'site-alpha': 'https://worker-alpha.example.com/sign' })}'`,
      `GATEWAY_TEMPLATE_WORKER_TOKEN_MAP='${JSON.stringify({ 'site-alpha': 'worker-token-alpha' })}'`,
      '',
    ].join('\n'))

    const result = runCli(['--profile', 'wedos_small', '--env-file', envFile, '--json'], { env: {} })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        profile: 'wedos_small',
        status: 'pass',
        envSource: envFile,
        counts: { critical: 0, warning: 0, total: 0 },
      }),
    )
  })

  it('returns a usage error for a missing profile', () => {
    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('--profile is required')
  })

  it('fails when template upstream host allowlist is missing', () => {
    const env = baseEnv('wedos_small')
    delete env.GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST

    const result = runCli(['--profile', 'wedos_small'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST is required')
  })

  it('fails when host->site binding map is missing', () => {
    const env = baseEnv('wedos_small')
    delete env.GATEWAY_SITE_ID_BY_HOST_MAP

    const result = runCli(['--profile', 'wedos_small'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('GATEWAY_SITE_ID_BY_HOST_MAP is required and must be a JSON object')
  })

  it('fails when worker routing map does not use /sign path', () => {
    const env = baseEnv('wedos_small')
    env.GATEWAY_TEMPLATE_WORKER_URL_MAP = JSON.stringify({
      'site-alpha': 'https://worker-alpha.example.com/template/sign',
      'site-beta': 'https://worker-beta.example.com/sign',
    })

    const result = runCli(['--profile', 'wedos_small'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('worker signer route drift detected (expected /sign)')
  })

  it('fails when worker token map misses coverage for mapped sites', () => {
    const env = baseEnv('wedos_small')
    env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = JSON.stringify({
      'site-alpha': 'worker-token-alpha',
    })

    const result = runCli(['--profile', 'wedos_small'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('GATEWAY_TEMPLATE_WORKER_TOKEN_MAP is missing token coverage for: site-beta')
  })

  it('fails when template mutations are enabled without template token', () => {
    const env = baseEnv('wedos_small')
    env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    delete env.GATEWAY_TEMPLATE_TOKEN

    const result = runCli(['--profile', 'wedos_small'], { env })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('GATEWAY_TEMPLATE_TOKEN is required when GATEWAY_TEMPLATE_ALLOW_MUTATIONS is enabled')
  })
})
