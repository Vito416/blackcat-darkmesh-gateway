import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli, validateSignoffRecord } from '../scripts/validate-signoff-record.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'signoff-record-'))
  tempDirs.push(dir)
  const file = join(dir, 'SIGNOFF_RECORD.md')
  writeFileSync(file, text, 'utf8')
  return file
}

function validRecord(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    recordDate: '2026-04-11T12:00:00Z',
    preparedBy: '@ops-lead',
    repo: 'blackcat-darkmesh-gateway',
    relatedRelease: '1.4.0',
    migrationSummary: 'ops/decommission/FINAL_MIGRATION_SUMMARY.md',
    checklist: 'ops/decommission/DECOMMISSION_CHECKLIST.md',
    decision: 'GO',
    decisionRationale: 'All required evidence is complete and reviewed.',
    decisionTime: '2026-04-11T12:10:00Z',
    scopeCovered: 'Gateway migration closeout and signoff evidence.',
    scopeExcluded: 'Future maintenance and post-signoff follow-up tasks.',
    releaseSummaryTime: '2026-04-11T11:45:00Z',
    ledgerTime: '2026-04-11T11:46:00Z',
    manifestTime: '2026-04-11T11:47:00Z',
    aoGateTime: '2026-04-11T11:48:00Z',
    ciTime: '2026-04-11T11:49:00Z',
    rollbackTime: '2026-04-11T11:50:00Z',
    approvalTime: '2026-04-11T11:51:00Z',
    rollbackDoc: 'ops/decommission/DECOMMISSION_CHECKLIST.md',
    rollbackOwner: '@ops-lead',
    rollbackEvidence: 'tmp/rollback-proof.md',
    openRisk: 'Residual operator review risk after closeout.',
    riskReason: 'Human approvals still need final confirmation.',
    mitigation: 'Rollback evidence and release ledger are attached.',
    followUpOwner: '@ops-lead',
    reviewDate: '2026-04-18T00:00:00Z',
  }

  const merged = { ...values, ...overrides }

  return [
    '# Signoff Record',
    '',
    '## Record metadata',
    '',
    `- **Record date (UTC):** \`${merged.recordDate}\``,
    `- **Prepared by:** \`${merged.preparedBy}\``,
    `- **Repo:** \`${merged.repo}\``,
    `- **Related release / tag:** \`${merged.relatedRelease}\``,
    `- **Related migration summary:** \`${merged.migrationSummary}\``,
    `- **Related checklist:** \`${merged.checklist}\``,
    '',
    '## Decision',
    '',
    `- **Decision:** \`${merged.decision}\``,
    `- **Decision rationale:** ${merged.decisionRationale}`,
    `- **Decision time (UTC):** \`${merged.decisionTime}\``,
    `- **Scope covered:** ${merged.scopeCovered}`,
    `- **Scope excluded:** ${merged.scopeExcluded}`,
    '',
    '## Evidence reviewed',
    '',
    '| Artifact | UTC timestamp | Link | Notes |',
    '| --- | --- | --- | --- |',
    `| Final migration summary | \`${merged.releaseSummaryTime}\` | \`${merged.migrationSummary}\` | Reviewed |`,
    `| Release evidence ledger | \`${merged.ledgerTime}\` | \`ops/decommission/release-evidence-ledger.json\` | Reviewed |`,
    `| Release drill manifest | \`${merged.manifestTime}\` | \`ops/decommission/release-drill-manifest.json\` | Reviewed |`,
    `| AO dependency gate validation | \`${merged.aoGateTime}\` | \`ops/decommission/ao-dependency-gate.json\` | Reviewed |`,
    `| CI / workflow run | \`${merged.ciTime}\` | \`https://example.invalid/actions/runs/123\` | Reviewed |`,
    `| Rollback proof | \`${merged.rollbackTime}\` | \`${merged.rollbackEvidence}\` | Reviewed |`,
    '',
    '## Approvals',
    '',
    '| Role | Name / handle | UTC approval time | Evidence reviewed | Approval |',
    '| --- | --- | --- | --- | --- |',
    `| Security | \`@sec-lead\` | \`${merged.approvalTime}\` | Final migration summary; release evidence ledger | approved |`,
    `| Operations | \`@ops-lead\` | \`${merged.approvalTime}\` | Release drill manifest; rollback proof | approved |`,
    `| Architecture | \`@arch-lead\` | \`${merged.approvalTime}\` | AO dependency gate validation; final migration summary | approved |`,
    `| Product / owner | \`@owner\` | \`${merged.approvalTime}\` | CI / workflow run; rollback proof | approved |`,
    '',
    '## Rollback reference',
    '',
    `- **Rollback document:** \`${merged.rollbackDoc}\``,
    `- **Rollback owner:** \`${merged.rollbackOwner}\``,
    `- **Rollback tested (UTC):** \`${merged.decisionTime}\``,
    `- **Rollback evidence link:** \`${merged.rollbackEvidence}\``,
    '',
    '## Residual risks',
    '',
    `- **Open risk:** ${merged.openRisk}`,
    `- **Why it remains:** ${merged.riskReason}`,
    `- **Mitigation in place:** ${merged.mitigation}`,
    `- **Follow-up owner:** \`${merged.followUpOwner}\``,
    `- **Review date (UTC):** \`${merged.reviewDate}\``,
    '',
    '## Final notes',
    '',
    '- Keep this record immutable once signoff is complete.',
    '- If a blocker appears after signoff, append a dated addendum rather than rewriting the decision trail.',
    '',
  ].join('\n')
}

describe('validate-signoff-record.js', () => {
  it('accepts a complete signoff record', () => {
    const file = makeTempFile(validRecord())
    const result = runCli(['--file', file])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Status: ok')
    expect(result.stdout).toContain('Validation passed.')
  })

  it('returns structured JSON for a valid record', () => {
    const file = makeTempFile(validRecord())
    const result = runCli(['--file', file, '--json'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const payload = JSON.parse(result.stdout)
    expect(payload.file).toBe(file)
    expect(payload.status).toBe('ok')
    expect(payload.ok).toBe(true)
    expect(payload.blockers).toEqual([])
    expect(payload.warnings).toEqual([])
    expect(payload.sections['Record metadata'].present).toBe(true)
    expect(payload.sections['Approvals'].present).toBe(true)
  })

  it('rejects a record with missing headings', () => {
    const file = makeTempFile(
      validRecord().replace('\n## Approvals\n', '\n## Approval Review\n'),
    )
    const result = runCli(['--file', file, '--json'])

    expect(result.exitCode).toBe(3)
    const payload = JSON.parse(result.stdout)
    expect(payload.status).toBe('blocked')
    expect(payload.blockers.some((entry: string) => entry.includes('missing required heading: Approvals'))).toBe(true)
  })

  it('ignores placeholders without strict mode', () => {
    const file = makeTempFile(validRecord({ decisionRationale: '...' }))
    const result = runCli(['--file', file, '--json'])

    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.status).toBe('ok')
    expect(payload.warnings).toEqual([])
    expect(payload.blockers).toEqual([])
  })

  it('fails strict mode when placeholder content is present', () => {
    const file = makeTempFile(validRecord({ decisionTime: 'YYYY-MM-DDTHH:MM:SSZ' }))
    const result = runCli(['--file', file, '--strict'])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Status: blocked')
    expect(result.stdout).toContain('placeholder content in Decision (line')
  })

  it('returns a usage error for unknown flags', () => {
    const result = runCli(['--unknown'])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: unknown option: --unknown')
  })

  it('detects structural problems via the pure validator', () => {
    const result = validateSignoffRecord('## Record metadata\n\n- **Record date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`\n', {
      strict: true,
    })

    expect(result.ok).toBe(false)
    expect(result.blockers.some((entry) => entry.includes('missing required heading: Decision'))).toBe(true)
    expect(result.blockers.some((entry) => entry.includes('placeholder content'))).toBe(true)
  })
})
