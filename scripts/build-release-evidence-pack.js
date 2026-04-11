#!/usr/bin/env node

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_BUNDLE_FILES = ['compare.txt', 'attestation.json', 'manifest.json']
const TIMESTAMPED_DIR_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(?:-.+)?$/

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-release-evidence-pack.js [--release <VERSION>] [--consistency-dir <DIR>] [--evidence-dir <DIR>] [--out <FILE>] [--json-out <FILE>] [--require-both]',
      '',
      'Options:',
      '  --release <VERSION>      Release label/version (default: 1.4.0)',
      '  --consistency-dir <DIR>  Directory with consistency-smoke artifacts',
      '  --evidence-dir <DIR>     Directory with evidence-dry-run artifacts',
      '  --out <FILE>             Optional markdown output path',
      '  --json-out <FILE>        Optional JSON output path',
      '  --require-both           Exit non-zero when consistency or evidence data is missing',
      '  --json                   Print JSON summary to stdout (markdown is default)',
      '  --help                   Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   missing/invalid release evidence',
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
    release: '1.4.0',
    consistencyDir: '',
    evidenceDir: '',
    out: '',
    jsonOut: '',
    requireBoth: false,
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`, 64)
      i += 1
      return next
    }

    switch (arg) {
      case '--release':
        args.release = readValue()
        break
      case '--consistency-dir':
        args.consistencyDir = readValue()
        break
      case '--evidence-dir':
        args.evidenceDir = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      case '--require-both':
        args.requireBoth = true
        break
      case '--json':
        args.json = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.release)) die('--release must not be blank', 64)
  if (args.out && !isNonEmptyString(args.out)) die('--out must not be blank', 64)
  if (args.jsonOut && !isNonEmptyString(args.jsonOut)) die('--json-out must not be blank', 64)
  if (!args.consistencyDir && !args.evidenceDir) {
    die('at least one of --consistency-dir or --evidence-dir is required', 64)
  }

  return args
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (_) {
    return false
  }
}

function parseTimestampFromDir(name) {
  const match = TIMESTAMPED_DIR_RE.exec(name)
  if (!match) return null
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return { iso, ms }
}

async function findFileByName(rootDir, fileName) {
  const root = resolve(rootDir)
  if (!(await pathExists(root))) return ''

  const direct = join(root, fileName)
  if (await pathExists(direct)) return direct

  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, fileName)
    if (await pathExists(candidate)) return candidate
  }
  return ''
}

function resolveConsistencyStatus(matrix) {
  const counts = matrix?.counts
  if (!counts || typeof counts !== 'object') return { status: 'invalid', reason: 'missing counts' }
  const mismatch = Number.isInteger(counts.mismatch) ? counts.mismatch : 0
  const failure = Number.isInteger(counts.failure) ? counts.failure : 0
  if (failure > 0) return { status: 'fail', reason: `${failure} failure run(s)` }
  if (mismatch > 0) return { status: 'warn', reason: `${mismatch} mismatch run(s)` }
  return { status: 'pass', reason: 'all runs matched' }
}

async function collectConsistencyEvidence(rootDir) {
  if (!rootDir) {
    return { present: false, status: 'missing', reason: 'not provided', files: {} }
  }

  const matrixFile = await findFileByName(rootDir, 'consistency-matrix.json')
  const summaryFile = await findFileByName(rootDir, 'consistency-drift-summary.json')
  const reportFile = await findFileByName(rootDir, 'consistency-drift-report.md')

  if (!matrixFile && !summaryFile && !reportFile) {
    return { present: false, status: 'missing', reason: 'artifact files not found', files: {} }
  }

  let matrix = null
  let summary = null
  try {
    if (matrixFile) matrix = await readJson(matrixFile)
    if (summaryFile) summary = await readJson(summaryFile)
  } catch (err) {
    return {
      present: true,
      status: 'invalid',
      reason: err instanceof Error ? err.message : String(err),
      files: { matrixFile, summaryFile, reportFile },
    }
  }

  const fromMatrix = matrix ? resolveConsistencyStatus(matrix) : null
  const fromSummary =
    summary && isNonEmptyString(summary.status)
      ? {
          status:
            summary.status === 'critical'
              ? 'fail'
              : summary.status === 'warning'
                ? 'warn'
                : summary.status === 'ok'
                  ? 'pass'
                  : 'invalid',
          reason: `summary status=${summary.status}`,
        }
      : null

  const status = fromMatrix?.status || fromSummary?.status || 'invalid'
  const reason = fromMatrix?.reason || fromSummary?.reason || 'missing status markers'

  return {
    present: true,
    status,
    reason,
    files: { matrixFile, summaryFile, reportFile },
    counts: matrix?.counts || summary?.counts || null,
  }
}

async function findLatestBundleDir(rootDir) {
  const root = resolve(rootDir)
  if (!(await pathExists(root))) return ''
  const entries = await readdir(root, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseTimestampFromDir(entry.name)
    if (!parsed) continue
    candidates.push({ dir: join(root, entry.name), ms: parsed.ms, name: entry.name })
  }
  if (!candidates.length) return ''
  candidates.sort((a, b) => (a.ms === b.ms ? a.name.localeCompare(b.name) : a.ms - b.ms))
  return candidates[candidates.length - 1].dir
}

async function collectEvidenceBundle(rootDir) {
  if (!rootDir) {
    return { present: false, status: 'missing', reason: 'not provided', latestBundleDir: '', files: {} }
  }

  const latestBundleDir = await findLatestBundleDir(rootDir)
  const exchangePackFile = await findFileByName(rootDir, 'attestation-exchange-pack.json')

  if (!latestBundleDir) {
    return {
      present: false,
      status: 'missing',
      reason: 'no timestamped bundle directory found',
      latestBundleDir: '',
      files: { exchangePackFile },
    }
  }

  const fileMap = {
    comparePath: join(latestBundleDir, 'compare.txt'),
    attestationPath: join(latestBundleDir, 'attestation.json'),
    manifestPath: join(latestBundleDir, 'manifest.json'),
    exchangePackFile,
  }

  const missing = []
  for (const fileName of REQUIRED_BUNDLE_FILES) {
    const path = join(latestBundleDir, fileName)
    if (!(await pathExists(path))) missing.push(fileName)
  }

  let manifest = null
  if (!missing.length) {
    try {
      manifest = await readJson(fileMap.manifestPath)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        latestBundleDir,
        files: fileMap,
      }
    }
  }

  let exchangeSummary = null
  if (exchangePackFile) {
    try {
      const exchangePack = await readJson(exchangePackFile)
      exchangeSummary = exchangePack?.summary || null
    } catch (_) {
      exchangeSummary = null
    }
  }

  if (missing.length) {
    return {
      present: true,
      status: 'invalid',
      reason: `missing required bundle files: ${missing.join(', ')}`,
      latestBundleDir,
      files: fileMap,
    }
  }

  const manifestStatus = manifest?.status
  const compareExit = manifest?.compare?.exitCode
  const attestationExit = manifest?.attestation?.exitCode
  const isPass = manifestStatus === 'ok' && compareExit === 0 && attestationExit === 0

  return {
    present: true,
    status: isPass ? 'pass' : 'fail',
    reason: isPass
      ? 'latest bundle strict markers are ok'
      : `manifest status=${manifestStatus ?? 'unknown'}, compare=${compareExit ?? 'n/a'}, attestation=${attestationExit ?? 'n/a'}`,
    latestBundleDir,
    files: fileMap,
    manifestStatus: manifestStatus ?? 'unknown',
    compareExit: Number.isInteger(compareExit) ? compareExit : null,
    attestationExit: Number.isInteger(attestationExit) ? attestationExit : null,
    exchangeSummary,
  }
}

function combineReadiness(consistency, evidence, requireBoth) {
  const blockers = []
  const warnings = []

  if (!consistency.present) {
    if (requireBoth) blockers.push(`consistency evidence missing: ${consistency.reason}`)
    else warnings.push(`consistency evidence missing: ${consistency.reason}`)
  } else if (consistency.status === 'fail' || consistency.status === 'invalid') {
    blockers.push(`consistency status=${consistency.status}: ${consistency.reason}`)
  } else if (consistency.status === 'warn') {
    warnings.push(`consistency warning: ${consistency.reason}`)
  }

  if (!evidence.present) {
    if (requireBoth) blockers.push(`evidence bundle missing: ${evidence.reason}`)
    else warnings.push(`evidence bundle missing: ${evidence.reason}`)
  } else if (evidence.status !== 'pass') {
    blockers.push(`evidence status=${evidence.status}: ${evidence.reason}`)
  }

  const status = blockers.length > 0 ? 'not-ready' : warnings.length > 0 ? 'warning' : 'ready'
  return { status, blockers, warnings }
}

function renderMarkdown(pack) {
  const lines = []
  lines.push('# Release Evidence Pack')
  lines.push('')
  lines.push(`- Release: ${pack.release}`)
  lines.push(`- Generated: ${pack.createdAt}`)
  lines.push(`- Status: **${pack.status.toUpperCase()}**`)
  lines.push('')

  lines.push('## Consistency')
  lines.push(`- Present: ${pack.consistency.present ? 'yes' : 'no'}`)
  lines.push(`- Status: ${pack.consistency.status}`)
  lines.push(`- Reason: ${pack.consistency.reason}`)
  if (pack.consistency.counts) {
    lines.push(
      `- Counts: total=${pack.consistency.counts.total ?? 'n/a'}, pass=${pack.consistency.counts.pass ?? 'n/a'}, mismatch=${pack.consistency.counts.mismatch ?? 'n/a'}, failure=${pack.consistency.counts.failure ?? 'n/a'}`,
    )
  }
  if (pack.consistency.files?.reportFile) {
    lines.push(`- Drift report: ${pack.consistency.files.reportFile}`)
  }
  lines.push('')

  lines.push('## Evidence bundle')
  lines.push(`- Present: ${pack.evidence.present ? 'yes' : 'no'}`)
  lines.push(`- Status: ${pack.evidence.status}`)
  lines.push(`- Reason: ${pack.evidence.reason}`)
  if (pack.evidence.latestBundleDir) {
    lines.push(`- Latest bundle: ${pack.evidence.latestBundleDir}`)
  }
  if (pack.evidence.files?.exchangePackFile) {
    lines.push(`- Exchange pack: ${pack.evidence.files.exchangePackFile}`)
  }
  lines.push('')

  if (pack.blockers.length > 0) {
    lines.push('## Blockers')
    for (const blocker of pack.blockers) lines.push(`- ${blocker}`)
    lines.push('')
  }

  if (pack.warnings.length > 0) {
    lines.push('## Warnings')
    for (const warning of pack.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }

  lines.push('## Sign-off hints')
  lines.push('- Attach this pack with consistency and evidence artifacts to the release PR.')
  lines.push('- Ensure AO-side registry/authority/audit dependencies are closed before final merge.')
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function writeText(path, content) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const consistency = await collectConsistencyEvidence(args.consistencyDir)
  const evidence = await collectEvidenceBundle(args.evidenceDir)
  const readiness = combineReadiness(consistency, evidence, args.requireBoth)

  const pack = {
    createdAt: new Date().toISOString(),
    release: args.release,
    status: readiness.status,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    consistency,
    evidence,
  }

  const markdown = renderMarkdown(pack)
  if (args.out) await writeText(args.out, markdown)
  if (args.jsonOut) await writeText(args.jsonOut, `${JSON.stringify(pack, null, 2)}\n`)

  process.stdout.write(args.json ? `${JSON.stringify(pack, null, 2)}\n` : markdown)
  if (readiness.status === 'not-ready') process.exit(3)
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

export {
  combineReadiness,
  parseArgs,
  parseTimestampFromDir,
  renderMarkdown,
  resolveConsistencyStatus,
  runCli,
}
