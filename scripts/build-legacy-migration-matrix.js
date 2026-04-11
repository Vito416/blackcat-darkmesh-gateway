#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MANIFEST = 'libs/legacy/MANIFEST.md'
const DEFAULT_OUT = 'kernel-migration/legacy-libs-matrix.md'
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info', 'unknown']
const RISK_ARRAY_KEYS = ['findings', 'risks', 'issues', 'entries', 'results', 'records', 'items']

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-legacy-migration-matrix.js [--manifest <FILE>] [--risk <FILE>] [--out <FILE>] [--json] [--help]',
      '',
      'Options:',
      '  --manifest <FILE>  Legacy manifest path (default: libs/legacy/MANIFEST.md)',
      '  --risk <FILE>      Optional risk JSON from audit-legacy-risk output',
      '  --out <FILE>       Output markdown path (default: kernel-migration/legacy-libs-matrix.md)',
      '  --json             Print summary JSON to stdout',
      '  --help             Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   invalid input or runtime error',
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

function stripFormatting(value) {
  return String(value ?? '')
    .trim()
    .replace(/^`+|`+$/g, '')
    .trim()
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    risk: '',
    out: DEFAULT_OUT,
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        die(`missing value for ${arg}`, 64)
      }
      i += 1
      return next
    }

    switch (arg) {
      case '--manifest':
        args.manifest = readValue()
        break
      case '--risk':
        args.risk = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json':
        args.json = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.manifest)) die('--manifest must not be blank', 64)
  if (args.risk && !isNonEmptyString(args.risk)) die('--risk must not be blank', 64)
  if (!isNonEmptyString(args.out)) die('--out must not be blank', 64)

  return args
}

function normalizeKey(value) {
  return stripFormatting(value).toLowerCase()
}

function parseMarkdownTableRows(markdown) {
  const lines = String(markdown).split(/\r?\n/)
  const rows = []
  let inSourceSnapshots = false
  let sawTableHeader = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^##\s+Source snapshots\s*$/i.test(trimmed)) {
      inSourceSnapshots = true
      sawTableHeader = false
      continue
    }

    if (inSourceSnapshots && /^##\s+/.test(trimmed)) break
    if (!inSourceSnapshots || !trimmed.startsWith('|')) continue

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => stripFormatting(cell))

    if (cells.length < 2) continue

    if (!sawTableHeader) {
      const normalized = cells.map(normalizeKey)
      if (normalized.includes('module') && normalized.includes('source commit')) {
        sawTableHeader = true
      }
      continue
    }

    const isDivider = cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
    if (isDivider) continue

    const moduleName = cells[0]
    const sourceCommit = cells[1]
    if (!moduleName || normalizeKey(moduleName) === 'module') continue
    rows.push({
      module: moduleName,
      sourceCommit,
    })
  }

  return rows
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSeverityCounts(source) {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, 0]))

  if (!isObject(source)) return counts

  for (const severity of SEVERITY_ORDER) {
    const value = source[severity]
    if (Number.isFinite(value)) counts[severity] = value
  }

  return counts
}

function summarizeRiskInput(input) {
  const summary = {
    total: 0,
    severityCounts: Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, 0])),
    source: 'none',
  }

  if (!input) return summary

  if (Array.isArray(input)) {
    summary.source = 'array'
    for (const item of input) {
      const severity = normalizeRiskSeverity(isObject(item) ? item.severity ?? item.level ?? item.riskSeverity ?? item.priority : undefined)
      summary.severityCounts[severity] += 1
      summary.total += 1
    }
    return summary
  }

  if (!isObject(input)) return summary

  const directCounts = input.severityCounts ?? input.counts ?? input.summary?.severityCounts ?? input.summary?.counts
  if (isObject(directCounts)) {
    const normalized = normalizeSeverityCounts(directCounts)
    summary.severityCounts = normalized
    summary.total = SEVERITY_ORDER.reduce((total, severity) => total + normalized[severity], 0)
    summary.source = 'counts'
    return summary
  }

  for (const key of RISK_ARRAY_KEYS) {
    if (Array.isArray(input[key])) {
      summary.source = key
      for (const item of input[key]) {
        const severity = normalizeRiskSeverity(isObject(item) ? item.severity ?? item.level ?? item.riskSeverity ?? item.priority : undefined)
        summary.severityCounts[severity] += 1
        summary.total += 1
      }
      return summary
    }
  }

  return summary
}

function normalizeRiskSeverity(value) {
  const severity = stripFormatting(value).toLowerCase()
  if (SEVERITY_ORDER.includes(severity)) return severity
  return 'unknown'
}

function buildMarkdown(summary) {
  const lines = [
    '# Legacy Migration Matrix',
    '',
    `- Generated at (UTC): \`${summary.generatedAt}\``,
    `- Manifest: \`${summary.manifestLabel ?? summary.manifestPath}\``,
    summary.riskPath ? `- Risk JSON: \`${summary.riskLabel ?? summary.riskPath}\`` : '- Risk JSON: not provided',
    `- Module count: ${summary.modules.length}`,
    '',
    '## Modules',
    '',
    '| Module | Source commit | Risk summary |',
    '| --- | --- | --- |',
  ]

  for (const module of summary.modules) {
    lines.push(`| \`${module.module}\` | \`${module.sourceCommit}\` | pending |`)
  }

  lines.push(
    '',
    '## Risk summary',
    '',
    summary.riskPath
      ? `- Total findings: ${summary.riskSummary.total}`
      : '- Risk JSON was not provided; per-module risk summaries remain pending.',
  )

  if (summary.riskPath) {
    for (const severity of SEVERITY_ORDER) {
      lines.push(`- ${severity}: ${summary.riskSummary.severityCounts[severity]}`)
    }
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- The risk summary column is a placeholder until audit-legacy-risk findings are mapped into module-level review notes.',
    '',
  )

  return lines.join('\n')
}

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function writeText(filePath, text) {
  const outputPath = resolve(filePath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, text, 'utf8')
  return outputPath
}

export async function buildLegacyMigrationMatrix(options = {}) {
  const manifestPath = resolve(options.manifestPath ?? DEFAULT_MANIFEST)
  const outPath = resolve(options.outPath ?? DEFAULT_OUT)
  const generatedAt = (options.now ?? new Date()).toISOString()
  const manifestLabel = options.manifestLabel ?? options.manifestPath ?? DEFAULT_MANIFEST
  const riskLabel = options.riskLabel ?? options.riskPath ?? ''

  const manifestText = await readFile(manifestPath, 'utf8')
  const modules = parseMarkdownTableRows(manifestText)

  if (modules.length === 0) {
    throw new Error(`no legacy modules found in manifest: ${manifestPath}`)
  }

  const riskPath = options.riskPath ? resolve(options.riskPath) : ''
  const riskData = riskPath ? await readJson(riskPath) : null
  const riskSummary = summarizeRiskInput(riskData)

  const summary = {
    generatedAt,
    manifestPath,
    manifestLabel,
    outPath,
    riskPath,
    riskLabel,
    modules,
    moduleCount: modules.length,
    riskSummary,
  }

  const markdown = buildMarkdown(summary)
  await writeText(outPath, markdown)

  return {
    summary,
    markdown,
  }
}

export function parseArgsForTests(argv) {
  return parseArgs(argv)
}

export function parseLegacyManifestModules(markdown) {
  return parseMarkdownTableRows(markdown)
}

export function summarizeLegacyRiskInput(input) {
  return summarizeRiskInput(input)
}

export function renderLegacyMigrationMatrix(summary) {
  return buildMarkdown(summary)
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv)
  const { summary, markdown } = await buildLegacyMigrationMatrix({
    manifestPath: args.manifest,
    manifestLabel: args.manifest,
    riskPath: args.risk || '',
    riskLabel: args.risk || '',
    outPath: args.out,
    now: options.now,
  })

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } else {
    process.stdout.write(`${markdown}\n`)
  }

  return summary
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    die(message, 3)
  })
}
