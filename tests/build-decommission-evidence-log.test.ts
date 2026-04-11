import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DECISIONS,
  MANDATORY_MACHINE_ARTIFACTS,
  OPTIONAL_MACHINE_ARTIFACTS,
  buildDecommissionLog,
  parseArgs,
  runCli,
} from '../scripts/build-decommission-evidence-log.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'decommission-log-'))
  tempDirs.push(dir)
  return dir
}

async function seedArtifacts(dir: string, omit: string[] = []) {
  const omitSet = new Set(omit)
  const payloads: Record<string, string> = {
    'consistency-matrix.json': JSON.stringify({ counts: { total: 2, pass: 2, mismatch: 0, failure: 0 } }),
    'consistency-drift-report.md': '# Drift report\n',
    'consistency-drift-summary.json': JSON.stringify({ status: 'ok', counts: { total: 2 } }),
    'latest-evidence-bundle.json': JSON.stringify({
      bundleName: '2026-04-11T12-00-00Z-abc',
      bundleDir: join(dir, 'evidence', '2026-04-11T12-00-00Z-abc'),
    }),
    'ao-dependency-gate.validation.txt': 'valid dependency gate: ./kernel-migration/ao-dependency-gate.json\n',
    'release-evidence-pack.md': '# Release Evidence Pack\n',
    'release-evidence-pack.json': JSON.stringify({ release: '1.4.0', status: 'ready' }),
    'release-signoff-checklist.md': '# Release Sign-off Checklist\n',
    'release-readiness.json': JSON.stringify({ release: '1.4.0', status: 'ready', blockerCount: 0, warningCount: 0 }),
    'release-drill-manifest.json': JSON.stringify({
      release: '1.4.0',
      status: 'ready',
      artifacts: [{ path: 'release-evidence-pack.json', sizeBytes: 256, sha256: 'a'.repeat(64) }],
    }),
    'release-drill-manifest.validation.txt': 'valid release drill manifest: /tmp/release-drill-manifest.json\n',
    'release-drill-check.json': JSON.stringify({ ok: true, missing: [], issues: [] }),
    'release-evidence-ledger.md': '# Release Evidence Ledger\n',
    'release-evidence-ledger.json': JSON.stringify({ release: '1.4.0', overallStatus: 'ready' }),
  }

  for (const [name, content] of Object.entries(payloads)) {
    if (omitSet.has(name)) continue
    await writeFile(join(dir, name), `${content}\n`, 'utf8')
  }
}

describe('build-decommission-evidence-log.js', () => {
  it('parses CLI args and manual proof links', () => {
    const parsed = parseArgs([
      '--dir',
      './tmp/decommission-drill',
      '--operator',
      'ops-user',
      '--ticket',
      'GW-1234',
      '--decision',
      'go',
      '--notes',
      'final pass',
      '--out',
      './tmp/decommission-drill/out.md',
      '--json-out',
      './tmp/decommission-drill/out.json',
      '--recovery-drill-link',
      'https://example.com/recovery',
      '--ao-fallback-link',
      'https://example.com/fallback',
      '--rollback-proof-link',
      'https://example.com/rollback',
      '--approvals-link',
      'https://example.com/approvals',
      '--strict',
    ])

    expect(DECISIONS.has(parsed.decision)).toBe(true)
    expect(parsed.decision).toBe('go')
    expect(parsed.strict).toBe(true)
    expect(parsed.operator).toBe('ops-user')
    expect(parsed.ticket).toBe('GW-1234')
    expect(parsed.out).toBe('./tmp/decommission-drill/out.md')
    expect(parsed.jsonOut).toBe('./tmp/decommission-drill/out.json')
    expect(parsed.recoveryDrillLink).toContain('recovery')
  })

  it('builds a complete decommission log with artifact summary and manual proof links', async () => {
    const dir = await makeTempDir()
    await seedArtifacts(dir)

    const log = await buildDecommissionLog({
      dir,
      operator: 'ops-user',
      ticket: 'GW-1234',
      decision: 'pending',
      notes: 'human sign-off captured',
      recoveryDrillLink: 'https://example.com/recovery',
      aoFallbackLink: 'https://example.com/fallback',
      rollbackProofLink: 'https://example.com/rollback',
      approvalsLink: 'https://example.com/approvals',
    })

    expect(log.release).toBe('1.4.0')
    expect(log.status).toBe('complete')
    expect(log.presence.complete).toBe(true)
    expect(log.presence.requiredCount).toBe(MANDATORY_MACHINE_ARTIFACTS.length)
    expect(log.presence.optionalPresentCount).toBe(OPTIONAL_MACHINE_ARTIFACTS.length)
    expect(log.manualProofs).toHaveLength(4)
    expect(log.manualProofs[0].link).toContain('recovery')
    expect(log.notes).toContain('human sign-off captured')
    expect(log.artifacts).toHaveLength(MANDATORY_MACHINE_ARTIFACTS.length + OPTIONAL_MACHINE_ARTIFACTS.length)
  })

  it('writes markdown/json outputs and exits strict mode when required machine artifacts are missing', async () => {
    const dir = await makeTempDir()
    await seedArtifacts(dir, ['release-drill-check.json'])
    const outMd = join(dir, 'custom-evidence-log.md')
    const outJson = join(dir, 'custom-evidence-log.json')

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => code as never) as never)

    await runCli([
      '--dir',
      dir,
      '--operator',
      'ops-user',
      '--ticket',
      'GW-1234',
      '--decision',
      'go',
      '--out',
      outMd,
      '--json-out',
      outJson,
      '--strict',
    ])

    const markdown = await readFile(outMd, 'utf8')
    const json = JSON.parse(await readFile(outJson, 'utf8'))

    expect(markdown).toContain('# Decommission Evidence Log')
    expect(markdown).toContain('Missing mandatory artifacts')
    expect(json.status).toBe('blocked')
    expect(json.presence.missingMandatoryArtifacts).toContain('release-drill-check.json')
    expect(stdoutSpy).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(3)
  })
})
