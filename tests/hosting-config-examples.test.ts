import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { runCli } from '../scripts/validate-hosting-readiness.js'

const ROUTING_EXAMPLE_PATH = fileURLToPath(
  new URL('../config/template-worker-routing.example.json', import.meta.url),
)
const ENV_EXAMPLE_PATH = fileURLToPath(new URL('../config/example.env', import.meta.url))

describe('VPS config examples', () => {
  it('keeps worker routing example aligned to /sign contract', () => {
    const parsed = JSON.parse(readFileSync(ROUTING_EXAMPLE_PATH, 'utf8')) as Record<string, string>
    expect(Object.keys(parsed).length).toBeGreaterThan(0)

    for (const [site, urlRaw] of Object.entries(parsed)) {
      expect(typeof site).toBe('string')
      expect(site.trim().length).toBeGreaterThan(0)
      expect(typeof urlRaw).toBe('string')
      const url = new URL(urlRaw)
      expect(['http:', 'https:']).toContain(url.protocol)
      expect(url.pathname.replace(/\/+$/, '')).toBe('/sign')
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    }
  })

  it('keeps example.env vps_medium-ready for strict validation', () => {
    const result = runCli(
      ['--profile', 'vps_medium', '--env-file', ENV_EXAMPLE_PATH, '--strict', '--json'],
      { env: {} },
    )

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as {
      profile: string
      status: string
      counts: { critical: number; warning: number; total: number }
    }

    expect(parsed.profile).toBe('vps_medium')
    expect(parsed.status).toBe('pass')
    expect(parsed.counts.critical).toBe(0)
    expect(parsed.counts.warning).toBe(0)
  })
})
