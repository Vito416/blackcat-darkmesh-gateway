#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

const VALID_STATUSES = new Set(['open', 'in_progress', 'blocked', 'closed'])
const SEMVER_LIKE_RELEASE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-ao-gate-evidence.js --file <ao-dependency-gate.json> [--strict] [--json] [--help]',
    '',
    'Options:',
    '  --file <FILE>   AO dependency gate JSON file to validate (required)',
    '  --strict        Fail if any required check is not closed',
    '  --json          Print structured JSON output',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   gate evidence is acceptable',
    '  3   validation failed',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseArgs(argv) {
  const args = {
    file: '',
    strict: false,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }
    if (arg === '--strict') {
      args.strict = true
      continue
    }
    if (arg === '--json') {
      args.json = true
      continue
    }

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--file':
        args.file = readValue()
        break
      case '--file=':
        throw new CliError('missing value for --file', 64)
      default:
        if (arg.startsWith('--file=')) {
          args.file = arg.slice('--file='.length)
          break
        }
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.file)) throw new CliError('--file is required', 64)
  return args
}

async function readJson(filePath, label) {
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new Error(`unable to read ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function normalizeStatus(value) {
  return isNonEmptyString(value) ? value.trim().toLowerCase() : ''
}

function normalizeRelease(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function parseUpdatedAt(value, nowMs) {
  if (!isNonEmptyString(value)) {
    return { valid: false, iso: '', ageSeconds: null, reason: 'updatedAt must be a non-empty string' }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { valid: false, iso: '', ageSeconds: null, reason: 'updatedAt must be a valid ISO timestamp' }
  }

  const millisAhead = date.getTime() - nowMs
  if (millisAhead > 5 * 60 * 1000) {
    return { valid: false, iso: date.toISOString(), ageSeconds: null, reason: 'updatedAt must not be in the future' }
  }

  return {
    valid: true,
    iso: date.toISOString(),
    ageSeconds: Math.max(0, Math.round((nowMs - date.getTime()) / 1000)),
    reason: '',
  }
}

function isEvidencePresent(value) {
  if (isNonEmptyString(value)) return true
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => isNonEmptyString(item))
  }
  return false
}

function buildCheckSummary(check, requiredIds) {
  const id = isNonEmptyString(check.id) ? check.id.trim() : ''
  const status = normalizeStatus(check.status)
  const evidencePresent = isEvidencePresent(check.evidence) || isEvidencePresent(check.evidenceRefs)
  return {
    id,
    title: isNonEmptyString(check.title) ? check.title.trim() : '',
    status,
    required: requiredIds.has(id),
    evidencePresent,
    closed: status === 'closed',
  }
}

function validateGate(gate, options = {}) {
  const strict = options.strict === true
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now()
  const issues = []
  const warnings = []

  if (!isObject(gate)) {
    return {
      ok: false,
      closeoutReady: false,
      strict,
      release: '',
      updatedAt: '',
      updatedAtIso: '',
      updatedAtAgeSeconds: null,
      counts: {
        required: 0,
        checks: 0,
        closedRequired: 0,
        requiredOpen: 0,
        duplicateRequiredIds: 0,
        duplicateCheckIds: 0,
      },
      required: [],
      checks: [],
      issues: ['gate must be a JSON object'],
      warnings: [],
    }
  }

  const release = normalizeRelease(gate.release)
  if (!SEMVER_LIKE_RELEASE.test(release)) {
    issues.push('release must be a semver-like string such as 1.4.0')
  }

  const updatedAtInfo = parseUpdatedAt(gate.updatedAt, nowMs)
  if (!updatedAtInfo.valid) {
    issues.push(updatedAtInfo.reason)
  }

  const required = Array.isArray(gate.required) ? gate.required : null
  if (!required) {
    issues.push('required must be an array')
  }

  const checks = Array.isArray(gate.checks) ? gate.checks : null
  if (!checks) {
    issues.push('checks must be an array')
  }

  const requiredIds = new Set()
  let duplicateRequiredIds = 0
  if (required) {
    for (let index = 0; index < required.length; index += 1) {
      const value = required[index]
      if (!isNonEmptyString(value)) {
        issues.push(`required[${index}] must be a non-empty string`)
        continue
      }
      const id = value.trim()
      if (requiredIds.has(id)) {
        duplicateRequiredIds += 1
        issues.push(`required[${index}] must be unique`)
        continue
      }
      requiredIds.add(id)
    }
  }

  const checkSummaries = []
  const checkIds = new Set()
  let duplicateCheckIds = 0
  let closedRequiredCount = 0
  let requiredOpenCount = 0

  if (checks) {
    for (let index = 0; index < checks.length; index += 1) {
      const check = checks[index]
      if (!isObject(check)) {
        issues.push(`checks[${index}] must be an object`)
        continue
      }

      const summary = buildCheckSummary(check, requiredIds)
      checkSummaries.push(summary)

      if (!summary.id) {
        issues.push(`checks[${index}].id must be a non-empty string`)
        continue
      }

      if (checkIds.has(summary.id)) {
        duplicateCheckIds += 1
        issues.push(`checks[${index}].id must be unique`)
        continue
      }
      checkIds.add(summary.id)

      if (!VALID_STATUSES.has(summary.status)) {
        issues.push(`checks[${index}].status must be one of open, in_progress, blocked, closed`)
      }

      if (summary.closed) {
        if (!summary.evidencePresent) {
          issues.push(`checks[${index}] must include evidence references when status is closed`)
        }
      }

      if (summary.required && summary.status === 'closed') {
        closedRequiredCount += 1
      } else if (summary.required) {
        requiredOpenCount += 1
        const message = `required check ${summary.id} is not closed (status: ${summary.status || 'missing'})`
        if (strict) issues.push(message)
        else warnings.push(message)
      }
    }
  }

  if (required) {
    for (const id of requiredIds) {
      if (!checkIds.has(id)) {
        issues.push(`required id ${id} must be present in checks`)
      }
    }
  }

  const closeoutReady = issues.length === 0 && warnings.length === 0

  return {
    ok: issues.length === 0,
    closeoutReady,
    strict,
    release,
    updatedAt: isNonEmptyString(gate.updatedAt) ? gate.updatedAt.trim() : '',
    updatedAtIso: updatedAtInfo.iso,
    updatedAtAgeSeconds: updatedAtInfo.ageSeconds,
    counts: {
      required: requiredIds.size,
      checks: checkSummaries.length,
      closedRequired: closedRequiredCount,
      requiredOpen: requiredOpenCount,
      duplicateRequiredIds,
      duplicateCheckIds,
    },
    required: Array.from(requiredIds),
    checks: checkSummaries,
    issues,
    warnings,
  }
}

function renderHuman(summary) {
  const lines = []
  lines.push('# AO Gate Evidence Check')
  lines.push('')
  lines.push(`- File: \`${summary.file}\``)
  lines.push(`- Release: \`${summary.release || 'unknown'}\``)
  lines.push(`- Updated at: \`${summary.updatedAt || 'unknown'}\``)
  if (summary.updatedAtIso) lines.push(`- Updated at (UTC): \`${summary.updatedAtIso}\``)
  if (typeof summary.updatedAtAgeSeconds === 'number') {
    lines.push(`- Updated age: \`${summary.updatedAtAgeSeconds}s\``)
  }
  lines.push(`- Strict: ${summary.strict ? 'yes' : 'no'}`)
  lines.push(`- Closeout ready: ${summary.closeoutReady ? 'yes' : 'no'}`)
  lines.push(`- Result: ${summary.result}`)
  lines.push('')
  lines.push('## Counts')
  lines.push(`- Required checks: ${summary.counts.required}`)
  lines.push(`- Checks: ${summary.counts.checks}`)
  lines.push(`- Closed required checks: ${summary.counts.closedRequired}`)
  lines.push(`- Required checks still open: ${summary.counts.requiredOpen}`)
  lines.push(`- Duplicate required ids: ${summary.counts.duplicateRequiredIds}`)
  lines.push(`- Duplicate check ids: ${summary.counts.duplicateCheckIds}`)
  lines.push('')

  lines.push('## Checks')
  if (summary.checks.length === 0) {
    lines.push('- None')
  } else {
    for (const check of summary.checks) {
      const required = check.required ? 'required' : 'optional'
      const evidence = check.evidencePresent ? 'evidence=yes' : 'evidence=no'
      lines.push(`- ${check.id || '(missing id)'}: status=\`${check.status || 'missing'}\` ${required} ${evidence}`)
    }
  }

  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('## Warnings')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
  }

  if (summary.issues.length > 0) {
    lines.push('')
    lines.push('## Issues')
    for (const issue of summary.issues) lines.push(`- ${issue}`)
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

async function buildSummary(filePath, options = {}) {
  const gate = await readJson(filePath, filePath)
  const validation = validateGate(gate, options)
  return {
    ...validation,
    file: filePath,
  }
}

function usage(exitCode = 0) {
  console.log(usageText())
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
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

  return buildSummary(args.file, { strict: args.strict })
    .then((summary) => {
      const exitCode = summary.issues.length > 0 ? 3 : 0
      const result = {
        ...summary,
        result: summary.issues.length > 0 ? 'ERROR' : summary.warnings.length > 0 ? 'WARNING' : 'OK',
      }

      return {
        exitCode,
        stdout: args.json ? `${JSON.stringify(result, null, 2)}\n` : renderHuman(result),
        stderr: '',
        summary: result,
      }
    })
    .catch((err) => ({
      exitCode: 3,
      stdout: '',
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }))
}

async function main() {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => die(err instanceof Error ? err.message : String(err), 3))
}

export {
  buildSummary,
  isEvidencePresent,
  parseArgs,
  renderHuman,
  runCli,
  validateGate,
  usageText,
}
