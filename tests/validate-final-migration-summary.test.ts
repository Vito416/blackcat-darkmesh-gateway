import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli, validateFinalMigrationSummary } from '../scripts/validate-final-migration-summary.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'final-migration-summary-'))
  tempDirs.push(dir)
  const file = join(dir, 'FINAL_MIGRATION_SUMMARY.md')
  writeFileSync(file, text, 'utf8')
  return file
}

function validSummaryMarkdown() {
  return [
    '# Final Migration Summary',
    '',
    '## Migration overview',
    '',
    '- **Project:** `blackcat-darkmesh-gateway`',
    '- **Legacy source:** `blackcat-kernel-contracts`',
    '- **Target architecture:** `AO + gateway + write`',
    '- **Summary date (UTC):** `2026-04-11T10:15:00Z`',
    '- **Prepared by:** `@operator-01`',
    '- **Release / milestone:** `1.4.0`',
    '',
    '## Scope completed',
    '',
    '- **Included systems:**',
    '  - `AO`',
    '  - `gateway`',
    '- **Excluded systems:**',
    '  - `legacy kernel-contracts runtime`',
    '- **Key architecture changes:**',
    '  - `migrated to explicit boundary checks`',
    '- **User-facing changes:**',
    '  - `faster release drill closeout`',
    '',
    '## Evidence pack',
    '',
    '| Evidence item | UTC timestamp | Link | Notes |',
    '| --- | --- | --- | --- |',
    '| Final release drill | `2026-04-11T10:30:00Z` | `https://example.invalid/drill` | `approved by ops` |',
    '| Release evidence ledger | `2026-04-11T10:31:00Z` | `https://example.invalid/ledger` | `immutable record` |',
    '| CI run / workflow | `2026-04-11T10:32:00Z` | `https://github.com/example/actions/runs/1` | `build + tests passed` |',
    '| Staging / production-like validation | `2026-04-11T10:33:00Z` | `https://example.invalid/staging` | `verified with worker secrets` |',
    '| Manual operator proof | `2026-04-11T10:34:00Z` | `https://example.invalid/proof` | `signed off` |',
    '',
    '## Rollback reference',
    '',
    '- **Rollback reference:** `ops/decommission/rollback-plan-2026-04-11.md`',
    '- **Rollback owner:** `@operator-01`',
    '- **Rollback command / procedure:** `bash scripts/rollback.sh --plan ops/decommission/rollback-plan-2026-04-11.md`',
    '- **Rollback evidence link:** `https://example.invalid/rollback-evidence`',
    '- **Rollback tested at (UTC):** `2026-04-11T10:40:00Z`',
    '',
    '## Approvals',
    '',
    '| Role | Name / handle | UTC approval time | Evidence reviewed | Decision |',
    '| --- | --- | --- | --- | --- |',
    '| Security | `@sec-01` | `2026-04-11T10:45:00Z` | `https://example.invalid/security` | `approved` |',
    '| Operations | `@ops-01` | `2026-04-11T10:46:00Z` | `https://example.invalid/ops` | `approved` |',
    '| Architecture | `@arch-01` | `2026-04-11T10:47:00Z` | `https://example.invalid/arch` | `approved` |',
    '| Product / owner | `@owner-01` | `2026-04-11T10:48:00Z` | `https://example.invalid/product` | `approved` |',
    '',
    '## Residual risks',
    '',
    '- **Residual risk:** `worker secret compromise`',
    '- **Impact:** `medium`',
    '- **Likelihood:** `low`',
    '- **Mitigation:** `rotate worker secrets and review audit logs`',
    '- **Monitoring / alerting:** `central alert on failed auth bursts`',
    '- **Expiry / revisit date (UTC):** `2026-05-01T00:00:00Z`',
    '',
    '## Decommission decision',
    '',
    '- **Decision:** `GO`',
    '- **Decision time (UTC):** `2026-04-11T10:55:00Z`',
    '- **Final status:** `complete`',
    '- **Automation state:** `complete`',
    '- **AO/manual state:** `complete`',
    '- **Blockers remaining:** `none`',
    '- **Archive / cleanup reference:** `https://example.invalid/archive`',
    '',
    '## Operator notes',
    '',
    '- Keep every evidence link stable and reviewable after the migration window closes.',
    '- Record any follow-up closeout steps in the archive reference if they appear after signoff.',
    '',
  ].join('\n')
}

function placeholderSummaryMarkdown() {
  return [
    '# Final Migration Summary',
    '',
    '## Migration overview',
    '',
    '- **Project:** `blackcat-darkmesh-gateway`',
    '- **Legacy source:** `blackcat-kernel-contracts`',
    '- **Target architecture:** `AO + gateway + write`',
    '- **Summary date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`',
    '- **Prepared by:** `@operator-handle`',
    '- **Release / milestone:** `1.4.0` or `1.2.1` or final release tag',
    '',
    '## Scope completed',
    '',
    '- **Included systems:**',
    '  - `...`',
    '- **Excluded systems:**',
    '  - `...`',
    '- **Key architecture changes:**',
    '  - `...`',
    '- **User-facing changes:**',
    '  - `...`',
    '',
    '## Evidence pack',
    '',
    '| Evidence item | UTC timestamp | Link | Notes |',
    '| --- | --- | --- | --- |',
    '| Final release drill | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |',
    '| Release evidence ledger | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |',
    '| CI run / workflow | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |',
    '| Staging / production-like validation | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |',
    '| Manual operator proof | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `...` |',
    '',
    '## Rollback reference',
    '',
    '- **Rollback reference:** `...`',
    '- **Rollback owner:** `...`',
    '- **Rollback command / procedure:** `...`',
    '- **Rollback evidence link:** `...`',
    '- **Rollback tested at (UTC):** `YYYY-MM-DDTHH:MM:SSZ`',
    '',
    '## Approvals',
    '',
    '| Role | Name / handle | UTC approval time | Evidence reviewed | Decision |',
    '| --- | --- | --- | --- | --- |',
    '| Security | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |',
    '| Operations | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |',
    '| Architecture | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |',
    '| Product / owner | `...` | `YYYY-MM-DDTHH:MM:SSZ` | `...` | `approved / blocked` |',
    '',
    '## Residual risks',
    '',
    '- **Residual risk:** `...`',
    '- **Impact:** `low / medium / high`',
    '- **Likelihood:** `low / medium / high`',
    '- **Mitigation:** `...`',
    '- **Monitoring / alerting:** `...`',
    '- **Expiry / revisit date (UTC):** `YYYY-MM-DDTHH:MM:SSZ`',
    '',
    '## Decommission decision',
    '',
    '- **Decision:** `GO` / `NO-GO`',
    '- **Decision time (UTC):** `YYYY-MM-DDTHH:MM:SSZ`',
    '- **Final status:** `complete / partial / blocked`',
    '- **Automation state:** `complete / blocked`',
    '- **AO/manual state:** `complete / pending / blocked`',
    '- **Blockers remaining:** `...`',
    '- **Archive / cleanup reference:** `...`',
    '',
    '## Operator notes',
    '',
    '- Keep every evidence link stable and reviewable after the migration window closes.',
    '- If the decision is `NO-GO`, include the exact blocker and the next verification step.',
    '- If the automation finished but AO/manual proof links are still open, record that explicitly as `automation-complete` plus `ao-manual-pending` instead of collapsing it into a generic blocked note.',
    '- If the decision is `GO`, the rollback reference must still be present and reachable.',
    '',
  ].join('\n')
}

describe('validate-final-migration-summary.js', () => {
  it('accepts a fully populated final migration summary in strict mode', () => {
    const file = makeTempFile(validSummaryMarkdown())
    const result = runCli(['--file', file, '--strict'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`valid final migration summary: ${file}`)
    expect(result.stderr).toBe('')
  })

  it('accepts the template in non-strict mode but flags placeholders in strict mode', () => {
    const file = makeTempFile(placeholderSummaryMarkdown())

    const loose = runCli(['--file', file])
    expect(loose.exitCode).toBe(0)
    expect(loose.stdout).toContain(`valid final migration summary: ${file}`)
    expect(loose.stderr).toBe('')

    const strict = runCli(['--file', file, '--strict'])
    expect(strict.exitCode).toBe(3)
    expect(strict.stdout).toContain('invalid final migration summary:')
    expect(strict.stdout).toContain('placeholder value in strict mode')
    expect(strict.stdout).toContain('Migration overview -> Summary date (UTC)')
    expect(strict.stdout).toContain('Evidence pack -> Final release drill')
    expect(strict.stdout).toContain('Decommission decision -> Decision')
    expect(strict.stderr).toBe('')
  })

  it('emits deterministic JSON output', () => {
    const file = makeTempFile(validSummaryMarkdown())
    const result = runCli(['--file', file, '--json'])
    const payload = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.ok).toBe(true)
    expect(payload.strict).toBe(false)
    expect(payload.file).toBe(file)
    expect(payload.issueCount).toBe(0)
    expect(payload.strictIssueCount).toBe(0)
    expect(payload.sections['Evidence pack'].rows).toHaveLength(5)
    expect(payload.sections['Approvals'].rows).toHaveLength(4)
  })

  it('fails closed when required headings or fields are missing', () => {
    const file = makeTempFile([
      '# Final Migration Summary',
      '',
      '## Migration overview',
      '',
      '- **Project:** `blackcat-darkmesh-gateway`',
      '',
    ].join('\n'))

    const result = runCli(['--file', file])

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('missing required heading: ## Scope completed')
    expect(result.stdout).toContain('missing required heading: ## Evidence pack')
    expect(result.stdout).toContain('missing required field: Legacy source')
    expect(result.stdout).toContain('missing required field: Target architecture')
    expect(result.stdout).toContain('missing required field: Summary date (UTC)')
  })

  it('returns a usage error when --file is missing', () => {
    const result = runCli([])

    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('error: --file is required')
  })

  it('can be used as a pure validator helper', () => {
    const result = validateFinalMigrationSummary(validSummaryMarkdown(), { strict: true })

    expect(result.ok).toBe(true)
    expect(result.issueCount).toBe(0)
    expect(result.strictIssueCount).toBe(0)
    expect(result.sections['Decommission decision'].fields['Decision']).toBe('GO')
  })
})
