#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_FILE = 'ops/decommission/SIGNOFF_RECORD.md'

const REQUIRED_SECTIONS = [
  'Record metadata',
  'Decision',
  'Evidence reviewed',
  'Approvals',
  'Rollback reference',
  'Residual risks',
  'Final notes',
]

const REQUIRED_METADATA_FIELDS = [
  'Record date (UTC)',
  'Prepared by',
  'Repo',
  'Related release / tag',
  'Related migration summary',
  'Related checklist',
]

const REQUIRED_DECISION_FIELDS = [
  'Decision',
  'Decision rationale',
  'Decision time (UTC)',
  'Scope covered',
  'Scope excluded',
]

const REQUIRED_EVIDENCE_ARTIFACTS = [
  'Final migration summary',
  'Release evidence ledger',
  'Release drill manifest',
  'AO dependency gate validation',
  'CI / workflow run',
  'Rollback proof',
]

const REQUIRED_APPROVAL_ROLES = ['Security', 'Operations', 'Architecture', 'Product / owner']

const REQUIRED_ROLLBACK_FIELDS = ['Rollback document', 'Rollback owner', 'Rollback tested (UTC)', 'Rollback evidence link']
const REQUIRED_RESIDUAL_FIELDS = [
  'Open risk',
  'Why it remains',
  'Mitigation in place',
  'Follow-up owner',
  'Review date (UTC)',
]

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
    '  node scripts/validate-signoff-record.js [--file <FILE>] [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --file <FILE>   Signoff record markdown file to validate (default: ops/decommission/SIGNOFF_RECORD.md)',
    '  --json          Print structured JSON only',
    '  --strict        Fail on placeholder content',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   validation passed',
    '  3   structural blockers or strict-mode placeholder failures',
    '  64  usage or file access error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function stripInlineCode(value) {
  return typeof value === 'string' ? value.replace(/^`+/, '').replace(/`+$/, '').trim() : ''
}

function normalizeLabel(value) {
  return stripInlineCode(value).toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '').trim()
}

function normalizeValue(value) {
  return stripInlineCode(value).replace(/\s+/g, ' ').trim()
}

function isPlaceholderValue(value) {
  const text = normalizeValue(value)
  if (!text) return false
  return (
    text.includes('YYYY-MM-DDTHH:MM:SSZ') ||
    text.includes('@operator-handle') ||
    text.includes('GO / NO-GO') ||
    text.includes('approved / blocked') ||
    text === '...'
  )
}

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
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
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.file)) throw new CliError('--file is required', 64)
  return args
}

function splitSections(lines) {
  const sections = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(lines[index].trim())
    if (!headingMatch) continue

    const heading = headingMatch[1]
    const body = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^##\s+/.test(lines[cursor].trim())) break
      body.push({ lineNumber: cursor + 1, text: lines[cursor] })
    }
    sections.set(heading, body)
  }
  return sections
}

function collectBullets(section) {
  const bullets = []
  for (const entry of section) {
    const trimmed = entry.text.trim()
    const match =
      /^-\s+\*\*(.+?):\*\*\s*(.+)$/.exec(trimmed) ||
      /^-\s+\*\*(.+?)\*\*:\s*(.+)$/.exec(trimmed)
    if (!match) continue
    bullets.push({
      label: match[1].trim(),
      value: match[2].trim(),
      lineNumber: entry.lineNumber,
    })
  }
  return bullets
}

function collectTableRows(section) {
  return section
    .filter((entry) => entry.text.trim().startsWith('|'))
    .map((entry) => {
      const cells = entry.text
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
      return {
        lineNumber: entry.lineNumber,
        raw: entry.text.trim(),
        cells,
      }
    })
}

function pushMissingSection(blockers, sectionName) {
  blockers.push(`missing required heading: ${sectionName}`)
}

function validateFieldList(sectionName, section, requiredFields, blockers) {
  const bullets = collectBullets(section)
  const byLabel = new Map()
  for (const bullet of bullets) {
    byLabel.set(normalizeLabel(bullet.label), bullet)
  }

  for (const requiredField of requiredFields) {
    const bullet = byLabel.get(normalizeLabel(requiredField))
    if (!bullet) {
      blockers.push(`missing required field in ${sectionName}: ${requiredField}`)
      continue
    }
  }

  return bullets
}

function validateRequiredTable(sectionName, section, requiredHeaders, requiredRows, blockers) {
  const rows = collectTableRows(section)
  if (rows.length < 2) {
    blockers.push(`missing required table in ${sectionName}`)
    return rows
  }

  const header = rows[0].cells.map((cell) => normalizeLabel(cell))
  const expected = requiredHeaders.map((headerName) => normalizeLabel(headerName))
  for (let index = 0; index < expected.length; index += 1) {
    if (header[index] !== expected[index]) {
      blockers.push(`invalid table header in ${sectionName}: expected ${requiredHeaders.join(' | ')}`)
      break
    }
  }

  const byKey = new Map()
  for (const row of rows.slice(2)) {
    const key = normalizeLabel(row.cells[0])
    if (key) byKey.set(key, row)
  }

  for (const requiredRow of requiredRows) {
    if (!byKey.has(normalizeLabel(requiredRow))) {
      blockers.push(`missing required row in ${sectionName}: ${requiredRow}`)
    }
  }

  return rows
}

function validateSignoffRecord(text, { strict = false } = {}) {
  const blockers = []

  if (!isNonEmptyString(text)) {
    return {
      ok: false,
      status: 'blocked',
      blockers: ['signoff record must be non-empty text'],
      warnings: [],
      sections: {},
      file: '',
      strict,
    }
  }

  const lines = text.split(/\r?\n/)
  const sections = splitSections(lines)
  const sectionReport = {}

  for (const sectionName of REQUIRED_SECTIONS) {
    const section = sections.get(sectionName)
    if (!section) {
      pushMissingSection(blockers, sectionName)
      sectionReport[sectionName] = { present: false }
      continue
    }

    sectionReport[sectionName] = { present: true }

    if (sectionName === 'Record metadata') {
      validateFieldList(sectionName, section, REQUIRED_METADATA_FIELDS, blockers)
    } else if (sectionName === 'Decision') {
      validateFieldList(sectionName, section, REQUIRED_DECISION_FIELDS, blockers)
    } else if (sectionName === 'Evidence reviewed') {
      validateRequiredTable(
        sectionName,
        section,
        ['Artifact', 'UTC timestamp', 'Link', 'Notes'],
        REQUIRED_EVIDENCE_ARTIFACTS,
        blockers,
      )
    } else if (sectionName === 'Approvals') {
      validateRequiredTable(
        sectionName,
        section,
        ['Role', 'Name / handle', 'UTC approval time', 'Evidence reviewed', 'Approval'],
        REQUIRED_APPROVAL_ROLES,
        blockers,
      )
    } else if (sectionName === 'Rollback reference') {
      validateFieldList(sectionName, section, REQUIRED_ROLLBACK_FIELDS, blockers)
    } else if (sectionName === 'Residual risks') {
      validateFieldList(sectionName, section, REQUIRED_RESIDUAL_FIELDS, blockers)
    }

    if (strict) {
      for (const entry of section) {
        if (isPlaceholderValue(entry.text)) {
          blockers.push(`placeholder content in ${sectionName} (line ${entry.lineNumber})`)
        }
      }
    }
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length > 0 ? 'blocked' : 'ok',
    blockers,
    warnings: [],
    sections: sectionReport,
    strict,
  }
}

function renderHumanResult(filePath, result) {
  const lines = [`SIGNOFF record: ${filePath}`, `Status: ${result.status}`]

  if (result.blockers.length > 0) {
    lines.push('Blockers:')
    for (const blocker of result.blockers) lines.push(`- ${blocker}`)
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }

  if (result.blockers.length === 0 && result.warnings.length === 0) {
    lines.push('Validation passed.')
  }

  return `${lines.join('\n')}\n`
}

function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: usageText(), stderr: `error: ${err.message}\n` }
    }
    return { exitCode: 64, stdout: usageText(), stderr: `error: ${err instanceof Error ? err.message : String(err)}\n` }
  }

  if (args.help) {
    return { exitCode: 0, stdout: usageText(), stderr: '' }
  }

  const filePath = resolve(args.file)
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (err) {
    return {
      exitCode: 64,
      stdout: usageText(),
      stderr: `error: unable to read file: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  const result = validateSignoffRecord(text, { strict: args.strict })
  const payload = {
    file: args.file,
    strict: args.strict,
    ...result,
  }

  return {
    exitCode: result.ok ? 0 : 3,
    stdout: args.json ? `${JSON.stringify(payload, null, 2)}\n` : renderHumanResult(args.file, result),
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
  parseArgs,
  runCli,
  splitSections,
  usageText,
  validateSignoffRecord,
}
