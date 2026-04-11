#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const LEDGER_FILES = [
  'consistency-matrix.json',
  'consistency-drift-report.md',
  'consistency-drift-summary.json',
  'latest-evidence-bundle.json',
  'ao-dependency-gate.validation.txt',
  'release-evidence-pack.md',
  'release-evidence-pack.json',
  'release-signoff-checklist.md',
  'release-readiness.json',
  'release-drill-manifest.json',
  'release-drill-manifest.validation.txt',
  'release-drill-check.json',
]

const DECISIONS = new Set(['pending', 'go', 'no-go'])

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-release-evidence-ledger.js --dir <DRILL_DIR> [--operator <NAME>] [--decision pending|go|no-go] [--run-url <URL>] [--artifact-base-url <URL>] [--commit <SHA>] [--out <FILE>] [--json-out <FILE>] [--json] [--strict] [--help]',
      '',
      'Options:',
      '  --dir <DRILL_DIR>         Drill artifact directory (required)',
      '  --operator <NAME>         Operator name in ledger metadata (default: env RELEASE_DRILL_OPERATOR/GITHUB_ACTOR/USER)',
      '  --decision <VALUE>        pending|go|no-go (default: pending)',
      '  --run-url <URL>           Optional CI run URL',
      '  --artifact-base-url <URL> Optional stable artifact base URL',
      '  --commit <SHA>            Optional commit reference',
      '  --out <FILE>              Optional markdown output path (default: <dir>/release-evidence-ledger.md)',
      '  --json-out <FILE>         Optional JSON output path (default: <dir>/release-evidence-ledger.json)',
      '  --json                    Print ledger JSON to stdout (markdown by default)',
      '  --strict                  Exit 3 unless checks resolve to ready/ok',
      '  --help                    Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   strict failure or data error',
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

function parseArgs(argv) {
  const args = {
    dir: '',
    operator: '',
    decision: 'pending',
    runUrl: '',
    artifactBaseUrl: '',
    commit: '',
    out: '',
    jsonOut: '',
    json: false,
    strict: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') usage(0)
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
      if (typeof next === 'undefined' || next.startsWith('--')) {
        die(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--dir':
        args.dir = readValue()
        break
      case '--operator':
        args.operator = readValue()
        break
      case '--decision':
        args.decision = readValue().trim().toLowerCase()
        break
      case '--run-url':
        args.runUrl = readValue()
        break
      case '--artifact-base-url':
        args.artifactBaseUrl = readValue()
        break
      case '--commit':
        args.commit = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) die('--dir is required', 64)
  if (!DECISIONS.has(args.decision)) die(`unsupported decision value: ${args.decision}`, 64)

  return args
}

async function readJson(path, label) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new Error(`unable to read ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '')
}

function normalizePath(value) {
  return value.split(/[\\/]+/).join('/')
}

function asRelativePath(root, absolutePath) {
  return normalizePath(relative(root, absolutePath))
}

function normalizeOperator(operator) {
  const envValue =
    process.env.RELEASE_DRILL_OPERATOR || process.env.GITHUB_ACTOR || process.env.USER || process.env.USERNAME || 'unknown'
  const picked = isNonEmptyString(operator) ? operator.trim() : envValue
  return isNonEmptyString(picked) ? picked : 'unknown'
}

function normalizeRelease(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function normalizeStatus(value) {
  return isNonEmptyString(value) ? value.trim().toLowerCase() : ''
}

async function readArtifactRecord(drillDir, name, options = {}) {
  const artifactPath = join(drillDir, name)
  const info = await stat(artifactPath)
  if (!info.isFile()) throw new Error(`${name} is not a file`)
  const content = await readFile(artifactPath)
  const relPath = asRelativePath(drillDir, artifactPath)
  const sha256 = createHash('sha256').update(content).digest('hex')

  const base = trimTrailingSlashes(options.artifactBaseUrl || '')
  const url = base ? `${base}/${relPath}` : ''

  return {
    name,
    path: relPath,
    sizeBytes: info.size,
    sha256,
    url,
  }
}

function buildChecks(packStatus, readinessStatus, drillCheckOk, manifestValidated, aoGateValidated) {
  return {
    packReady: packStatus === 'ready',
    readinessReady: readinessStatus === 'ready',
    drillCheckOk: drillCheckOk === true,
    manifestValidated: manifestValidated === true,
    aoGateValidated: aoGateValidated === true,
  }
}

function deriveOverallStatus(checks) {
  if (
    checks.packReady &&
    checks.readinessReady &&
    checks.drillCheckOk &&
    checks.manifestValidated &&
    checks.aoGateValidated
  ) {
    return 'ready'
  }
  return 'blocked'
}

function renderMarkdown(ledger) {
  const lines = []
  lines.push('# Release Evidence Ledger')
  lines.push('')
  lines.push(`- Created (UTC): \`${ledger.createdAtUtc}\``)
  lines.push(`- Operator: \`${ledger.operator}\``)
  lines.push(`- Decision: \`${ledger.decision}\``)
  lines.push(`- Release: \`${ledger.release || 'unknown'}\``)
  lines.push(`- Overall status: \`${ledger.overallStatus}\``)
  if (ledger.run.runUrl) lines.push(`- Run URL: ${ledger.run.runUrl}`)
  if (ledger.run.commit) lines.push(`- Commit: \`${ledger.run.commit}\``)
  if (ledger.run.artifactBaseUrl) lines.push(`- Artifact base URL: ${ledger.run.artifactBaseUrl}`)
  lines.push('')

  lines.push('## Checks')
  lines.push(`- Pack ready: ${ledger.checks.packReady ? 'yes' : 'no'}`)
  lines.push(`- Readiness ready: ${ledger.checks.readinessReady ? 'yes' : 'no'}`)
  lines.push(`- Drill check OK: ${ledger.checks.drillCheckOk ? 'yes' : 'no'}`)
  lines.push(`- Manifest validated: ${ledger.checks.manifestValidated ? 'yes' : 'no'}`)
  lines.push(`- AO gate validated: ${ledger.checks.aoGateValidated ? 'yes' : 'no'}`)
  lines.push('')

  lines.push('## Artifacts')
  lines.push('| Artifact | Path | Size (bytes) | SHA-256 |')
  lines.push('| --- | --- | ---: | --- |')
  for (const artifact of ledger.artifacts) {
    lines.push(`| ${artifact.name} | \`${artifact.path}\` | ${artifact.sizeBytes} | \`${artifact.sha256}\` |`)
    if (artifact.url) lines.push(`| ↳ URL | ${artifact.url} |  |  |`)
  }
  lines.push('')

  lines.push('## Notes')
  if (ledger.notes.length === 0) {
    lines.push('- None')
  } else {
    for (const note of ledger.notes) lines.push(`- ${note}`)
  }
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function writeText(path, content) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function buildLedger(args) {
  const drillDir = resolve(args.dir)
  const files = []
  for (const name of LEDGER_FILES) {
    files.push(await readArtifactRecord(drillDir, name, { artifactBaseUrl: args.artifactBaseUrl }))
  }

  const pack = await readJson(join(drillDir, 'release-evidence-pack.json'), 'release-evidence-pack.json')
  const readiness = await readJson(join(drillDir, 'release-readiness.json'), 'release-readiness.json')
  const drillCheck = await readJson(join(drillDir, 'release-drill-check.json'), 'release-drill-check.json')
  const latestBundle = await readJson(join(drillDir, 'latest-evidence-bundle.json'), 'latest-evidence-bundle.json')
  const manifestValidation = await readFile(join(drillDir, 'release-drill-manifest.validation.txt'), 'utf8')
  const aoGateValidation = await readFile(join(drillDir, 'ao-dependency-gate.validation.txt'), 'utf8')

  const release = normalizeRelease(readiness.release) || normalizeRelease(pack.release)
  const packStatus = normalizeStatus(pack.status)
  const readinessStatus = normalizeStatus(readiness.status)

  const checks = buildChecks(
    packStatus,
    readinessStatus,
    drillCheck && typeof drillCheck === 'object' ? drillCheck.ok === true : false,
    manifestValidation.toLowerCase().includes('valid release drill manifest'),
    aoGateValidation.toLowerCase().includes('valid dependency gate'),
  )

  const overallStatus = deriveOverallStatus(checks)
  const notes = []
  if (latestBundle && typeof latestBundle === 'object') {
    if (isNonEmptyString(latestBundle.bundleName)) notes.push(`Latest evidence bundle: ${latestBundle.bundleName}`)
    if (isNonEmptyString(latestBundle.bundleDir)) notes.push(`Latest evidence bundle dir: ${latestBundle.bundleDir}`)
  }

  return {
    createdAtUtc: new Date().toISOString(),
    dir: drillDir,
    operator: normalizeOperator(args.operator),
    decision: args.decision,
    release,
    overallStatus,
    run: {
      runUrl: isNonEmptyString(args.runUrl) ? args.runUrl.trim() : '',
      artifactBaseUrl: isNonEmptyString(args.artifactBaseUrl) ? trimTrailingSlashes(args.artifactBaseUrl) : '',
      commit: isNonEmptyString(args.commit) ? args.commit.trim() : '',
    },
    checks,
    artifacts: files,
    notes,
  }
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const ledger = await buildLedger(args)
  const markdown = renderMarkdown(ledger)

  const outPath = args.out ? resolve(args.out) : join(resolve(args.dir), 'release-evidence-ledger.md')
  const jsonOutPath = args.jsonOut ? resolve(args.jsonOut) : join(resolve(args.dir), 'release-evidence-ledger.json')

  await writeText(outPath, markdown)
  await writeText(jsonOutPath, `${JSON.stringify(ledger, null, 2)}\n`)

  process.stdout.write(args.json ? `${JSON.stringify(ledger, null, 2)}\n` : markdown)

  if (args.strict && ledger.overallStatus !== 'ready') {
    process.exit(3)
  }
}

async function main() {
  try {
    await runCli(process.argv.slice(2))
  } catch (err) {
    die(err instanceof Error ? err.message : String(err), 3)
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export { DECISIONS, LEDGER_FILES, buildLedger, parseArgs, renderMarkdown, runCli }
