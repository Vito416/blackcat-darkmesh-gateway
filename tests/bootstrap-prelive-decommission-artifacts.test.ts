import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  buildPlan,
  parseArgs,
  runCli,
  usageText,
} from '../scripts/bootstrap-prelive-decommission-artifacts.js'

describe('bootstrap-prelive-decommission-artifacts.js', () => {
  it('parses defaults and validates profile/mode', () => {
    const args = parseArgs(['--dir', 'ops/decommission', '--release', '1.4.0'])
    expect(args.release).toBe('1.4.0')
    expect(args.profile).toBe('vps_medium')
    expect(args.mode).toBe('pairwise')
    expect(args.dir.endsWith(resolve('ops/decommission'))).toBe(true)
  })

  it('builds a deterministic dry-run plan', () => {
    const args = parseArgs([
      '--dir',
      'ops/decommission',
      '--release',
      '1.4.0',
      '--profile',
      'diskless',
      '--mode',
      'all',
      '--label',
      'smoke',
    ])
    const plan = buildPlan(args)

    expect(plan.release).toBe('1.4.0')
    expect(plan.profile).toBe('diskless')
    expect(plan.mode).toBe('all')
    expect(plan.seededBundleDir).toContain('-smoke')
    expect(plan.files.packJson.endsWith('release-evidence-pack.json')).toBe(true)
    expect(plan.files.templateVariantMap.endsWith('template-variant-map.json')).toBe(true)
  })

  it('returns usage text for --help via runCli', async () => {
    const result = await runCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--dry-run')
    expect(result.stderr).toBe('')
    expect(usageText()).toContain('pre-live bootstrap path')
  })

  it('returns a JSON plan in dry-run mode', async () => {
    const result = await runCli(['--dir', 'ops/decommission', '--release', '1.4.0', '--dry-run'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const payload = JSON.parse(result.stdout)
    expect(payload.dryRun).toBe(true)
    expect(payload.release).toBe('1.4.0')
    expect(payload.files.packJson.endsWith('release-evidence-pack.json')).toBe(true)
    expect(payload.files.templateVariantMap.endsWith('template-variant-map.json')).toBe(true)
  })
})
