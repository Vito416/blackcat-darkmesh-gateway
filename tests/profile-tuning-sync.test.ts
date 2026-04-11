import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveIntegrityFetchControl } from '../src/integrity/fetch-control.js'
import { buildSummary } from '../scripts/build-drift-alert-summary.js'

const RESOURCE_BUDGETS_PATH = resolve(process.cwd(), 'ops/resource-budgets.md')
const ALERT_PROFILES_PATH = resolve(process.cwd(), 'ops/alerts-profiles.md')

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSection(markdown: string, startHeading: string, endHeading: string) {
  const pattern = new RegExp(`${escapeRegExp(startHeading)}([\\s\\S]*?)${escapeRegExp(endHeading)}`)
  const match = markdown.match(pattern)
  if (!match) throw new Error(`unable to parse markdown section: ${startHeading}`)
  return match[1]
}

function readBudgetInt(section: string, key: string) {
  const pattern = new RegExp(`-\\s+\`${escapeRegExp(key)}=(\\d+)\``)
  const match = section.match(pattern)
  if (!match) throw new Error(`unable to find ${key} in budget section`)
  return Number.parseInt(match[1], 10)
}

function readTableRow(markdown: string, rowPrefix: string) {
  const line = markdown
    .split('\n')
    .map((value) => value.trim())
    .find((value) => {
      if (!value.startsWith('|')) return false
      const cells = value
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0)
      if (cells.length < 4) return false
      const label = cells[0].replace(/`/g, '').trim()
      return label === rowPrefix
    })
  if (!line) throw new Error(`unable to find table row: ${rowPrefix}`)
  const cells = line
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (cells.length < 4) throw new Error(`unexpected table shape for row: ${rowPrefix}`)
  const normalizeCell = (value: string) => value.replace(/^`|`$/g, '').trim()
  return {
    wedos_small: normalizeCell(cells[1]),
    wedos_medium: normalizeCell(cells[2]),
    diskless: normalizeCell(cells[3]),
  }
}

function readThresholdCell(cell: string) {
  const match = cell.match(/>\s*(\d+)/)
  if (!match) throw new Error(`threshold cell is missing numeric value: ${cell}`)
  return Number.parseInt(match[1], 10)
}

function readProfileDefaultsFromBudgets(markdown: string) {
  const small = getSection(markdown, '### Profile A: WEDOS small (conservative)', '### Profile B: WEDOS medium (balanced default)')
  const medium = getSection(markdown, '### Profile B: WEDOS medium (balanced default)', '### Profile C: Diskless/ephemeral host')
  const diskless = getSection(markdown, '### Profile C: Diskless/ephemeral host', '## Webhook verification budget')

  return {
    wedos_small: {
      timeoutMs: readBudgetInt(small, 'AO_INTEGRITY_FETCH_TIMEOUT_MS'),
      retryAttempts: readBudgetInt(small, 'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS'),
      retryBackoffMs: readBudgetInt(small, 'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS'),
      retryJitterMs: readBudgetInt(small, 'AO_INTEGRITY_FETCH_RETRY_JITTER_MS'),
      checkpointMaxAgeSeconds: readBudgetInt(small, 'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS'),
    },
    wedos_medium: {
      timeoutMs: readBudgetInt(medium, 'AO_INTEGRITY_FETCH_TIMEOUT_MS'),
      retryAttempts: readBudgetInt(medium, 'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS'),
      retryBackoffMs: readBudgetInt(medium, 'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS'),
      retryJitterMs: readBudgetInt(medium, 'AO_INTEGRITY_FETCH_RETRY_JITTER_MS'),
      checkpointMaxAgeSeconds: readBudgetInt(medium, 'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS'),
    },
    diskless: {
      timeoutMs: readBudgetInt(diskless, 'AO_INTEGRITY_FETCH_TIMEOUT_MS'),
      retryAttempts: readBudgetInt(diskless, 'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS'),
      retryBackoffMs: readBudgetInt(diskless, 'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS'),
      retryJitterMs: readBudgetInt(diskless, 'AO_INTEGRITY_FETCH_RETRY_JITTER_MS'),
    },
  }
}

describe('profile tuning synchronization', () => {
  it('keeps fetch-control defaults in sync with ops/resource-budgets.md', () => {
    const markdown = readFileSync(RESOURCE_BUDGETS_PATH, 'utf8')
    const expected = readProfileDefaultsFromBudgets(markdown)

    for (const profile of Object.keys(expected) as Array<keyof typeof expected>) {
      process.env = { ...originalEnv }
      process.env.GATEWAY_RESOURCE_PROFILE = profile
      delete process.env.AO_INTEGRITY_FETCH_TIMEOUT_MS
      delete process.env.AO_INTEGRITY_FETCH_RETRY_ATTEMPTS
      delete process.env.AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS
      delete process.env.AO_INTEGRITY_FETCH_RETRY_JITTER_MS

      const control = resolveIntegrityFetchControl()
      expect(control).toEqual({
        timeoutMs: expected[profile].timeoutMs,
        retryAttempts: expected[profile].retryAttempts,
        retryBackoffMs: expected[profile].retryBackoffMs,
        retryJitterMs: expected[profile].retryJitterMs,
      })
    }
  })

  it('keeps drift-summary anti-flap windows in sync with ops/alerts-profiles.md', () => {
    const markdown = readFileSync(ALERT_PROFILES_PATH, 'utf8')
    const mirrorRow = readTableRow(markdown, 'Mirror mismatch / mirror fetch fail')
    const auditRow = readTableRow(markdown, 'Audit lag')
    const checkpointRow = readTableRow(markdown, 'Checkpoint stale')
    const matrix = {
      mode: 'pairwise',
      counts: { total: 1, pass: 1, mismatch: 0, failure: 0 },
      issues: [],
    }

    for (const profile of ['wedos_small', 'wedos_medium', 'diskless'] as const) {
      const summary = buildSummary(matrix, profile)
      expect(summary.recommendedWindows).toEqual({
        mirror: mirrorRow[profile],
        auditLag: auditRow[profile],
        checkpoint: checkpointRow[profile],
      })
    }
  })

  it('keeps checkpoint stale thresholds below checkpoint max-age budgets', () => {
    const budgetsMarkdown = readFileSync(RESOURCE_BUDGETS_PATH, 'utf8')
    const expected = readProfileDefaultsFromBudgets(budgetsMarkdown)
    const alertsMarkdown = readFileSync(ALERT_PROFILES_PATH, 'utf8')
    const checkpointThresholdRow = readTableRow(alertsMarkdown, 'gateway_integrity_checkpoint_age_seconds stale')

    const smallThreshold = readThresholdCell(checkpointThresholdRow.wedos_small)
    const mediumThreshold = readThresholdCell(checkpointThresholdRow.wedos_medium)
    const disklessThreshold = readThresholdCell(checkpointThresholdRow.diskless)

    expect(smallThreshold).toBeLessThan(expected.wedos_small.checkpointMaxAgeSeconds)
    expect(mediumThreshold).toBeLessThan(expected.wedos_medium.checkpointMaxAgeSeconds)
    expect(disklessThreshold).toBeLessThan(smallThreshold)
  })
})
