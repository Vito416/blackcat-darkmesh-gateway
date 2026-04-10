#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VALID_PROFILES = new Set(['wedos_small', 'wedos_medium', 'diskless'])

const PROFILE_WINDOWS = {
  wedos_small: {
    mirror: 'for: 2m',
    auditLag: 'for: 12m',
    checkpoint: 'for: 15m',
  },
  wedos_medium: {
    mirror: 'for: 1m',
    auditLag: 'for: 8m',
    checkpoint: 'for: 10m',
  },
  diskless: {
    mirror: 'for: 1m',
    auditLag: 'for: 10m',
    checkpoint: 'for: 12m',
  },
}

const ALERTS = {
  mismatch: ['GatewayIntegrityMirrorMismatch'],
  failure: ['GatewayIntegrityMirrorFetchFail', 'GatewayIntegrityAuditLagHigh', 'GatewayIntegrityCheckpointStale'],
}

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-drift-alert-summary.js --matrix <FILE> [--profile wedos_small|wedos_medium|diskless] [--out <FILE>] [--json] [--json-out <FILE>]',
      '',
      'Options:',
      '  --matrix <FILE>     JSON output file produced by compare-integrity-matrix.js (required)',
      '  --profile <NAME>    Deployment profile (default: wedos_medium)',
      '  --out <FILE>        Optional markdown output file path',
      '  --json              Print JSON summary to stdout (markdown is default)',
      '  --json-out <FILE>   Optional JSON summary output file path',
      '  --help              Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   data/validation error',
      '  64  usage error',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 3) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }
  return value
}

function parseArgs(argv) {
  const args = {
    matrix: '',
    profile: 'wedos_medium',
    out: '',
    json: false,
    jsonOut: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) {
        die(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--matrix':
        args.matrix = readValue()
        break
      case '--profile':
        args.profile = readValue().trim().toLowerCase()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json':
        args.json = true
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.matrix)) die('--matrix is required', 64)
  if (!VALID_PROFILES.has(args.profile)) die(`unsupported profile: ${args.profile}`, 64)
  if (args.out && !isNonEmptyString(args.out)) die('--out must not be blank', 64)
  if (args.jsonOut && !isNonEmptyString(args.jsonOut)) die('--json-out must not be blank', 64)

  return args
}

function parseMatrixJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('matrix payload must be a JSON object')
  }

  const counts = value.counts
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new Error('matrix payload must include counts')
  }

  const summary = {
    total: parseInteger(counts.total, 'counts.total'),
    pass: parseInteger(counts.pass, 'counts.pass'),
    mismatch: parseInteger(counts.mismatch, 'counts.mismatch'),
    failure: parseInteger(counts.failure, 'counts.failure'),
  }

  const runs = Array.isArray(value.runs) ? value.runs : []
  const issues = runs
    .filter((run) => run && typeof run === 'object' && run.outcome !== 'pass')
    .map((run, index) => ({
      index: Number.isInteger(run.index) ? run.index : index + 1,
      name: isNonEmptyString(run.name) ? run.name : `run-${index + 1}`,
      status: isNonEmptyString(run.status) ? run.status : 'UNKNOWN',
      reason: isNonEmptyString(run.reason) ? run.reason : 'no reason supplied',
      labels: Array.isArray(run.labels) ? run.labels.filter((value) => isNonEmptyString(value)) : [],
    }))

  return {
    mode: isNonEmptyString(value.mode) ? value.mode : 'unknown',
    counts: summary,
    issues,
  }
}

function buildSummary(matrix, profile) {
  const status = matrix.counts.failure > 0 ? 'critical' : matrix.counts.mismatch > 0 ? 'warning' : 'ok'

  const alertSet = new Set()
  if (matrix.counts.mismatch > 0) {
    for (const alertName of ALERTS.mismatch) alertSet.add(alertName)
  }
  if (matrix.counts.failure > 0) {
    for (const alertName of ALERTS.failure) alertSet.add(alertName)
  }

  return {
    createdAt: new Date().toISOString(),
    profile,
    mode: matrix.mode,
    status,
    counts: matrix.counts,
    issueCount: matrix.issues.length,
    issues: matrix.issues,
    recommendedAlerts: Array.from(alertSet),
    recommendedWindows: PROFILE_WINDOWS[profile],
  }
}

function buildMarkdown(summary) {
  const lines = []
  lines.push('# Multi-region drift report')
  lines.push('')
  lines.push(`- Generated: ${summary.createdAt}`)
  lines.push(`- Profile: ${summary.profile}`)
  lines.push(`- Compare mode: ${summary.mode}`)
  lines.push(`- Status: **${summary.status.toUpperCase()}**`)
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('| --- | ---: |')
  lines.push(`| Total runs | ${summary.counts.total} |`)
  lines.push(`| Pass | ${summary.counts.pass} |`)
  lines.push(`| Mismatch | ${summary.counts.mismatch} |`)
  lines.push(`| Failure | ${summary.counts.failure} |`)
  lines.push('')

  if (summary.recommendedAlerts.length > 0) {
    lines.push('## Alert summary')
    for (const alertName of summary.recommendedAlerts) {
      lines.push(`- ${alertName}`)
    }
    lines.push('')
    lines.push('### Suggested anti-flap windows')
    lines.push(`- Mirror mismatch / fetch fail: ${summary.recommendedWindows.mirror}`)
    lines.push(`- Audit lag: ${summary.recommendedWindows.auditLag}`)
    lines.push(`- Checkpoint stale: ${summary.recommendedWindows.checkpoint}`)
    lines.push('')
  }

  if (summary.issues.length > 0) {
    lines.push('## Non-pass runs')
    for (const issue of summary.issues) {
      const labels = issue.labels.length > 0 ? ` [${issue.labels.join(' <-> ')}]` : ''
      lines.push(`- ${issue.name}${labels}: ${issue.status} — ${issue.reason}`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

async function readJsonFile(path) {
  const filePath = resolve(path)
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new Error(`unable to read matrix file: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`invalid matrix JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function writeTextFile(path, content) {
  const filePath = resolve(path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return filePath
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const matrixPayload = await readJsonFile(args.matrix)
  const matrix = parseMatrixJson(matrixPayload)
  const summary = buildSummary(matrix, args.profile)
  const markdown = buildMarkdown(summary)

  if (args.out) {
    await writeTextFile(args.out, markdown)
  }
  if (args.jsonOut) {
    await writeTextFile(args.jsonOut, `${JSON.stringify(summary, null, 2)}\n`)
  }

  process.stdout.write(args.json ? `${JSON.stringify(summary, null, 2)}\n` : markdown)
}

async function main() {
  try {
    await runCli(process.argv.slice(2))
    process.exit(0)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    die(message, 3)
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export { buildMarkdown, buildSummary, parseArgs, parseMatrixJson, runCli }
