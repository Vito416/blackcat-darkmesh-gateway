#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/validate-final-migration-summary.js --file <FILE> [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --file <FILE>   Final migration summary markdown file to validate (required)',
    '  --json          Print JSON only',
    '  --strict        Reject placeholder values such as `...` and `YYYY-...`',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   valid summary',
    '  3   invalid summary or strict placeholder issues',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeText(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanLabel(value) {
  return normalizeText(value).replace(/:\s*$/, '')
}

function isHeading(line, level, title) {
  const prefix = '#'.repeat(level)
  return new RegExp(`^${prefix}\\s+${escapeRegExp(title)}\\s*$`).test(line.trim())
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitLines(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
}

function parseArgs(argv) {
  const args = {
    file: '',
    json: false,
    strict: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }
    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '--strict') {
      args.strict = true
      continue
    }

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--file':
        args.file = readValue()
        break
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.file)) {
    throw new CliError('--file is required', 64)
  }

  return args
}

function extractSections(lines) {
  const sections = new Map()
  const orderedHeadings = [
    'Final Migration Summary',
    'Migration overview',
    'Scope completed',
    'Evidence pack',
    'Rollback reference',
    'Approvals',
    'Residual risks',
    'Decommission decision',
    'Operator notes',
  ]

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith('#')) continue

    for (let level = 1; level <= 6; level += 1) {
      if (isHeading(line, level, orderedHeadings[0])) {
        sections.set(orderedHeadings[0], { level, start: index, end: lines.length })
        break
      }
      if (level === 2) {
        for (const heading of orderedHeadings.slice(1)) {
          if (isHeading(line, level, heading)) {
            sections.set(heading, { level, start: index, end: lines.length })
            break
          }
        }
      }
    }
  }

  const ordered = orderedHeadings.map((heading) => {
    const entry = sections.get(heading)
    return { heading, ...entry }
  })

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]
    const next = ordered[index + 1]
    if (current && typeof current.start === 'number') {
      current.end = next && typeof next.start === 'number' ? next.start : lines.length
    }
  }

  return ordered
}

function sectionText(lines, section) {
  if (!section || typeof section.start !== 'number') return ''
  return lines.slice(section.start + 1, section.end).join('\n')
}

function parseBulletFields(sectionLines) {
  const result = new Map()
  let current = null

  const flush = () => {
    if (!current) return
    const valueParts = []
    if (isNonEmptyString(current.inline)) valueParts.push(current.inline)
    if (current.nested.length > 0) valueParts.push(...current.nested)
    result.set(current.label, normalizeText(valueParts.join(' ')))
    current = null
  }

  for (const rawLine of sectionLines) {
    const line = rawLine.replace(/\s+$/, '')
    const topMatch = line.match(/^- \*\*(.+?)\*\*\s*:?\s*(.*)$/)
    if (topMatch) {
      flush()
      current = {
        label: cleanLabel(topMatch[1]),
        inline: normalizeText(topMatch[2] || ''),
        nested: [],
      }
      continue
    }

    const nestedMatch = line.match(/^\s+-\s+(.*)$/)
    if (current && nestedMatch) {
      current.nested.push(normalizeText(nestedMatch[1]))
      continue
    }

    if (current && isNonEmptyString(line)) {
      current.nested.push(normalizeText(line))
    }
  }

  flush()
  return result
}

function splitTableCells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => normalizeText(cell))
}

function parseTable(sectionLines) {
  const rows = []
  for (const rawLine of sectionLines) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue
    const cells = splitTableCells(line)
    if (cells.length > 0) {
      rows.push(cells)
    }
  }
  if (rows.length === 0) return null

  const headerIndex = rows.findIndex((row) => row.some((cell) => /evidence item|role/i.test(cell)))
  if (headerIndex < 0 || rows.length < headerIndex + 2) {
    return { headers: [], rows: [] }
  }

  return {
    headers: rows[headerIndex],
    rows: rows.slice(headerIndex + 2),
  }
}

function looksLikeStrictPlaceholder(value) {
  const normalized = normalizeText(value)
  if (!normalized) return false
  return (
    normalized === '...' ||
    normalized.includes('...') ||
    normalized.includes('YYYY-') ||
    normalized.includes('@operator-handle') ||
    /final release tag/i.test(normalized) ||
    /approved \/ blocked/i.test(normalized) ||
    /low \/ medium \/ high/i.test(normalized) ||
    /GO \/ NO-GO/i.test(normalized) ||
    /complete \/ partial \/ blocked/i.test(normalized) ||
    /complete \/ blocked/i.test(normalized) ||
    /complete \/ pending \/ blocked/i.test(normalized)
  )
}

function issue(message, section, field, strict = false) {
  return {
    message,
    section,
    field: field || '',
    strict,
  }
}

function validateBulletSection(sectionName, lines, expectedFields, strict, issues) {
  const fields = parseBulletFields(lines)
  const sectionIssues = []

  for (const fieldName of expectedFields) {
    const value = fields.get(fieldName) || ''
    if (!isNonEmptyString(value)) {
      sectionIssues.push(issue(`missing required field: ${fieldName}`, sectionName, fieldName))
      continue
    }
    if (strict && looksLikeStrictPlaceholder(value)) {
      sectionIssues.push(issue(`placeholder value in strict mode: ${fieldName} = ${value}`, sectionName, fieldName, true))
    }
  }

  issues.push(...sectionIssues)
  return {
    present: true,
    fields: Object.fromEntries(fields.entries()),
    issues: sectionIssues,
  }
}

function validateTableSection(sectionName, lines, expectedHeaders, expectedRowLabels, strict, issues) {
  const table = parseTable(lines)
  const sectionIssues = []

  if (!table || table.headers.length === 0) {
    sectionIssues.push(issue('missing required markdown table', sectionName, 'table'))
    issues.push(...sectionIssues)
    return { present: true, headers: [], rows: [], issues: sectionIssues }
  }

  const headerText = table.headers.join(' | ')
  const expectedHeaderText = expectedHeaders.join(' | ')
  if (headerText !== expectedHeaderText) {
    sectionIssues.push(
      issue(`table headers must match: ${expectedHeaderText}`, sectionName, 'table')
    )
  }

  const rowsByLabel = new Map()
  for (const row of table.rows) {
    if (row.length === 0) continue
    rowsByLabel.set(row[0], row)
  }

  for (const label of expectedRowLabels) {
    const row = rowsByLabel.get(label)
    if (!row) {
      sectionIssues.push(issue(`missing required table row: ${label}`, sectionName, label))
      continue
    }

    for (let index = 1; index < Math.min(row.length, expectedHeaders.length); index += 1) {
      const cell = row[index]
      if (!isNonEmptyString(cell)) {
        sectionIssues.push(issue(`empty table cell in row ${label}`, sectionName, label))
        continue
      }
      if (strict && looksLikeStrictPlaceholder(cell)) {
        sectionIssues.push(
          issue(`placeholder value in strict mode: ${label} column ${expectedHeaders[index]} = ${cell}`, sectionName, label, true)
        )
      }
    }
  }

  issues.push(...sectionIssues)
  return {
    present: true,
    headers: table.headers,
    rows: table.rows,
    issues: sectionIssues,
  }
}

function validateFinalMigrationSummary(markdown, { strict = false } = {}) {
  const issues = []
  const lines = splitLines(markdown)
  const sections = extractSections(lines)

  if (!isHeading(lines[0] || '', 1, 'Final Migration Summary')) {
    issues.push(issue('missing required heading: # Final Migration Summary', 'document', 'title'))
  }

  const sectionLookup = new Map(sections.map((section) => [section.heading, section]))
  const requiredHeadings = sections.map((section) => section.heading).filter((heading) => heading !== 'Final Migration Summary')

  for (const heading of requiredHeadings) {
    const section = sectionLookup.get(heading)
    if (!section || typeof section.start !== 'number') {
      issues.push(issue(`missing required heading: ## ${heading}`, 'document', heading))
    }
  }

  const overviewSection = sectionLookup.get('Migration overview')
  const scopeSection = sectionLookup.get('Scope completed')
  const evidenceSection = sectionLookup.get('Evidence pack')
  const rollbackSection = sectionLookup.get('Rollback reference')
  const approvalsSection = sectionLookup.get('Approvals')
  const risksSection = sectionLookup.get('Residual risks')
  const decisionSection = sectionLookup.get('Decommission decision')
  const operatorNotesSection = sectionLookup.get('Operator notes')

  const sectionStates = {}

  if (overviewSection && typeof overviewSection.start === 'number') {
    sectionStates['Migration overview'] = validateBulletSection(
      'Migration overview',
      splitLines(sectionText(lines, overviewSection)),
      ['Project', 'Legacy source', 'Target architecture', 'Summary date (UTC)', 'Prepared by', 'Release / milestone'],
      strict,
      issues
    )
  }

  if (scopeSection && typeof scopeSection.start === 'number') {
    sectionStates['Scope completed'] = validateBulletSection(
      'Scope completed',
      splitLines(sectionText(lines, scopeSection)),
      ['Included systems', 'Excluded systems', 'Key architecture changes', 'User-facing changes'],
      strict,
      issues
    )
  }

  if (evidenceSection && typeof evidenceSection.start === 'number') {
    sectionStates['Evidence pack'] = validateTableSection(
      'Evidence pack',
      splitLines(sectionText(lines, evidenceSection)),
      ['Evidence item', 'UTC timestamp', 'Link', 'Notes'],
      [
        'Final release drill',
        'Release evidence ledger',
        'CI run / workflow',
        'Staging / production-like validation',
        'Manual operator proof',
      ],
      strict,
      issues
    )
  }

  if (rollbackSection && typeof rollbackSection.start === 'number') {
    sectionStates['Rollback reference'] = validateBulletSection(
      'Rollback reference',
      splitLines(sectionText(lines, rollbackSection)),
      ['Rollback reference', 'Rollback owner', 'Rollback command / procedure', 'Rollback evidence link', 'Rollback tested at (UTC)'],
      strict,
      issues
    )
  }

  if (approvalsSection && typeof approvalsSection.start === 'number') {
    sectionStates['Approvals'] = validateTableSection(
      'Approvals',
      splitLines(sectionText(lines, approvalsSection)),
      ['Role', 'Name / handle', 'UTC approval time', 'Evidence reviewed', 'Decision'],
      ['Security', 'Operations', 'Architecture', 'Product / owner'],
      strict,
      issues
    )
  }

  if (risksSection && typeof risksSection.start === 'number') {
    sectionStates['Residual risks'] = validateBulletSection(
      'Residual risks',
      splitLines(sectionText(lines, risksSection)),
      ['Residual risk', 'Impact', 'Likelihood', 'Mitigation', 'Monitoring / alerting', 'Expiry / revisit date (UTC)'],
      strict,
      issues
    )
  }

  if (decisionSection && typeof decisionSection.start === 'number') {
    sectionStates['Decommission decision'] = validateBulletSection(
      'Decommission decision',
      splitLines(sectionText(lines, decisionSection)),
      ['Decision', 'Decision time (UTC)', 'Final status', 'Automation state', 'AO/manual state', 'Blockers remaining', 'Archive / cleanup reference'],
      strict,
      issues
    )
  }

  if (operatorNotesSection && typeof operatorNotesSection.start === 'number') {
    const raw = normalizeText(sectionText(lines, operatorNotesSection))
    if (!isNonEmptyString(raw)) {
      issues.push(issue('missing required section content: Operator notes', 'Operator notes', 'content'))
    } else if (strict && looksLikeStrictPlaceholder(raw)) {
      issues.push(issue(`placeholder value in strict mode: Operator notes = ${raw}`, 'Operator notes', 'content', true))
    }
    sectionStates['Operator notes'] = {
      present: true,
      content: raw,
      issues: [],
    }
  }

  const ok = issues.length === 0
  const strictIssueCount = issues.filter((entry) => entry.strict).length

  return {
    ok,
    strict,
    file: '',
    issueCount: issues.length,
    strictIssueCount,
    sections: sectionStates,
    issues,
  }
}

function renderHumanResult(filePath, result) {
  if (result.ok) {
    return `valid final migration summary: ${filePath}\n`
  }

  return [
    'invalid final migration summary:',
    ...result.issues.map((entry) => {
      const scope = [entry.section, entry.field].filter(Boolean).join(' -> ')
      return scope ? `- ${entry.message} [${scope}]` : `- ${entry.message}`
    }),
    '',
  ].join('\n')
}

function renderJsonResult(filePath, result) {
  return JSON.stringify(
    {
      file: filePath,
      ok: result.ok,
      strict: result.strict,
      issueCount: result.issueCount,
      strictIssueCount: result.strictIssueCount,
      issues: result.issues,
      sections: result.sections,
    },
    null,
    2
  )
}

function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: usageText(), stderr: `error: ${err.message}\n` }
    }
    return {
      exitCode: 64,
      stdout: usageText(),
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  if (args.help) {
    return { exitCode: 0, stdout: usageText(), stderr: '' }
  }

  let text
  try {
    text = readFileSync(args.file, 'utf8')
  } catch (err) {
    return {
      exitCode: 64,
      stdout: usageText(),
      stderr: `error: unable to read file: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  const result = validateFinalMigrationSummary(text, { strict: args.strict })
  result.file = args.file

  return {
    exitCode: result.ok ? 0 : 3,
    stdout: args.json ? `${renderJsonResult(args.file, result)}\n` : renderHumanResult(args.file, result),
    stderr: '',
  }
}

function main() {
  const result = runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) main()

export {
  CliError,
  extractSections,
  looksLikeStrictPlaceholder,
  parseArgs,
  parseBulletFields,
  parseTable,
  renderHumanResult,
  renderJsonResult,
  runCli,
  usageText,
  validateFinalMigrationSummary,
}
