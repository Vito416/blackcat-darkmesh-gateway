#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MANIFEST = 'libs/legacy/MANIFEST.md'
const DEFAULT_CORE_MAP = 'kernel-migration/core-primitive-map.json'
const DEFAULT_OUT = 'kernel-migration/legacy-libs-matrix.md'
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info', 'unknown']
const RISK_ARRAY_KEYS = ['findings', 'risks', 'issues', 'entries', 'results', 'records', 'items']
const CORE_PRIMITIVE_STATUSES = ['mapped', 'validated', 'pending', 'blocked', 'unknown']

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-legacy-migration-matrix.js [--manifest <FILE>] [--risk <FILE>] [--core-map <FILE>] [--out <FILE>] [--json] [--help]',
      '',
      'Options:',
      '  --manifest <FILE>  Legacy manifest path (default: libs/legacy/MANIFEST.md)',
      '  --risk <FILE>      Optional risk JSON from audit-legacy-risk output',
      '  --core-map <FILE>  Optional machine-readable blackcat-core primitive map',
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
    coreMap: '',
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
      case '--core-map':
        args.coreMap = readValue()
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
  if (args.coreMap && !isNonEmptyString(args.coreMap)) die('--core-map must not be blank', 64)
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

function normalizePrimitiveStatus(value) {
  const status = stripFormatting(value).toLowerCase()
  if (CORE_PRIMITIVE_STATUSES.includes(status)) return status
  return 'unknown'
}

function normalizeStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`)
  }

  return value.map((entry, index) => {
    if (!isNonEmptyString(entry)) {
      throw new Error(`${fieldName}[${index}] must be a non-empty string`)
    }
    return stripFormatting(entry)
  })
}

function parseCorePrimitiveMap(input) {
  if (!isObject(input)) {
    throw new Error('core primitive map must be a JSON object')
  }

  const moduleName = stripFormatting(input.module)
  if (normalizeKey(moduleName) !== 'blackcat-core') {
    throw new Error('core primitive map must describe blackcat-core')
  }

  const sourceCommit = stripFormatting(input.sourceCommit)
  if (!isNonEmptyString(sourceCommit)) {
    throw new Error('core primitive map must include sourceCommit')
  }

  const requestPathProof = stripFormatting(input.requestPathProof)
  if (!isNonEmptyString(requestPathProof)) {
    throw new Error('core primitive map must include requestPathProof')
  }

  const primitiveGroupsRaw = input.primitiveGroups ?? input.primitives
  if (!Array.isArray(primitiveGroupsRaw) || primitiveGroupsRaw.length === 0) {
    throw new Error('core primitive map must include at least one primitive group')
  }

  const primitiveGroups = primitiveGroupsRaw.map((group, index) => {
    if (!isObject(group)) {
      throw new Error(`core primitive map primitiveGroups[${index}] must be a JSON object`)
    }

    const name = stripFormatting(group.name)
    if (!isNonEmptyString(name)) {
      throw new Error(`core primitive map primitiveGroups[${index}].name must be a non-empty string`)
    }

    const legacySymbols = normalizeStringArray(
      group.legacySymbols,
      `core primitive map primitiveGroups[${index}].legacySymbols`,
    )
    const gatewayPaths = normalizeStringArray(
      group.gatewayPaths,
      `core primitive map primitiveGroups[${index}].gatewayPaths`,
    )
    const tests = normalizeStringArray(group.tests, `core primitive map primitiveGroups[${index}].tests`)
    const proof = stripFormatting(group.proof)
    if (!isNonEmptyString(proof)) {
      throw new Error(`core primitive map primitiveGroups[${index}].proof must be a non-empty string`)
    }

    return {
      name,
      legacySymbols,
      gatewayPaths,
      tests,
      proof,
      status: normalizePrimitiveStatus(group.status ?? 'mapped'),
    }
  })

  return {
    module: moduleName,
    sourceCommit,
    requestPathProof,
    status: normalizePrimitiveStatus(input.status ?? 'in progress'),
    primitiveGroups,
  }
}

function summarizeCorePrimitiveMap(input) {
  if (!input) return null

  const parsed = parseCorePrimitiveMap(input)
  const testCount = parsed.primitiveGroups.reduce((total, group) => total + group.tests.length, 0)
  const gatewayPathCount = parsed.primitiveGroups.reduce(
    (total, group) => total + group.gatewayPaths.length,
    0,
  )
  const mappedGroupCount = parsed.primitiveGroups.filter(
    (group) => group.status === 'mapped' || group.status === 'validated',
  ).length

  return {
    module: parsed.module,
    sourceCommit: parsed.sourceCommit,
    requestPathProof: parsed.requestPathProof,
    status: parsed.status,
    primitiveGroupCount: parsed.primitiveGroups.length,
    mappedGroupCount,
    gatewayPathCount,
    testCount,
    primitiveGroups: parsed.primitiveGroups,
    tableSummary: `${parsed.primitiveGroups.length} primitive groups, ${testCount} tests`,
  }
}

function buildMarkdown(summary) {
  const lines = [
    '# Legacy Migration Matrix',
    '',
    `- Generated at (UTC): \`${summary.generatedAt}\``,
    `- Manifest: \`${summary.manifestLabel ?? summary.manifestPath}\``,
    summary.riskPath ? `- Risk JSON: \`${summary.riskLabel ?? summary.riskPath}\`` : '- Risk JSON: not provided',
    summary.coreMapPath ? `- Core primitive map: \`${summary.coreMapLabel ?? summary.coreMapPath}\`` : '- Core primitive map: not provided',
    `- Module count: ${summary.modules.length}`,
    '',
    '## Modules',
    '',
    '| Module | Source commit | Risk summary |',
    '| --- | --- | --- |',
  ]

  for (const module of summary.modules) {
    const riskSummary =
      module.module === 'blackcat-core' && summary.corePrimitiveSummary
        ? summary.corePrimitiveSummary.tableSummary
        : 'pending'
    lines.push(`| \`${module.module}\` | \`${module.sourceCommit}\` | ${riskSummary} |`)
  }

  lines.push('', '## Risk summary', '')

  if (summary.riskPath) {
    lines.push(`- Total findings: ${summary.riskSummary.total}`)
    for (const severity of SEVERITY_ORDER) {
      lines.push(`- ${severity}: ${summary.riskSummary.severityCounts[severity]}`)
    }
  } else {
    lines.push('- Risk JSON was not provided; per-module risk summaries remain pending.')
  }

  if (summary.corePrimitiveSummary) {
    lines.push(
      '',
      '## Core primitive evidence',
      '',
      `- Module: \`${summary.corePrimitiveSummary.module}\``,
      `- Source commit: \`${summary.corePrimitiveSummary.sourceCommit}\``,
      `- Request-path proof: \`${summary.corePrimitiveSummary.requestPathProof}\``,
      `- Primitive groups: ${summary.corePrimitiveSummary.primitiveGroupCount}`,
      `- Test count: ${summary.corePrimitiveSummary.testCount}`,
      '',
      '| Primitive group | Legacy symbols | Gateway paths | Tests | Status |',
      '| --- | --- | --- | --- | --- |',
    )

    for (const group of summary.corePrimitiveSummary.primitiveGroups) {
      lines.push(
        `| ${group.name} | ${group.legacySymbols.map((symbol) => `\`${symbol}\``).join('<br>')} | ${group.gatewayPaths.map((path) => `\`${path}\``).join('<br>')} | ${group.tests.map((test) => `\`${test}\``).join('<br>')} | ${group.status} |`,
      )
    }
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- The risk summary column is a placeholder until audit-legacy-risk findings are mapped into module-level review notes.',
    summary.corePrimitiveSummary
      ? '- The core primitive evidence section is machine-readable and mirrors the gateway-owned runtime/core and runtime/template boundaries.'
      : '- Add a machine-readable core primitive map to surface blackcat-core proof once the remaining groups are finalized.',
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

async function readOptionalJson(filePath, { required = false } = {}) {
  try {
    return await readJson(filePath)
  } catch (error) {
    if (!required && error instanceof Error && /ENOENT/.test(error.message)) return null
    throw error
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
  const coreMapPath = options.coreMapPath ? resolve(options.coreMapPath) : DEFAULT_CORE_MAP
  const coreMapLabel = isNonEmptyString(options.coreMapLabel)
    ? options.coreMapLabel
    : isNonEmptyString(options.coreMapPath)
      ? options.coreMapPath
      : DEFAULT_CORE_MAP

  const manifestText = await readFile(manifestPath, 'utf8')
  const modules = parseMarkdownTableRows(manifestText)

  if (modules.length === 0) {
    throw new Error(`no legacy modules found in manifest: ${manifestPath}`)
  }

  const riskPath = options.riskPath ? resolve(options.riskPath) : ''
  const riskData = riskPath ? await readJson(riskPath) : null
  const riskSummary = summarizeRiskInput(riskData)
  const coreMapData = await readOptionalJson(coreMapPath, { required: Boolean(options.coreMapPath) })
  const corePrimitiveSummary = coreMapData ? summarizeCorePrimitiveMap(coreMapData) : null

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
    coreMapPath: coreMapData ? coreMapPath : '',
    coreMapLabel: coreMapData ? coreMapLabel : '',
    corePrimitiveSummary,
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

export function parseLegacyCorePrimitiveMap(input) {
  return parseCorePrimitiveMap(input)
}

export function summarizeLegacyCorePrimitiveMap(input) {
  return summarizeCorePrimitiveMap(input)
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
    coreMapPath: args.coreMap || '',
    coreMapLabel: args.coreMap || undefined,
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
