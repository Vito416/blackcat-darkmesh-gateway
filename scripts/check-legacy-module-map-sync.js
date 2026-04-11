#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

export const DEFAULT_MODULE_DOCS = [
  {
    key: 'migrationPlan',
    label: 'libs/legacy/MIGRATION_PLAN.md',
    path: 'libs/legacy/MIGRATION_PLAN.md',
  },
  {
    key: 'legacyModuleMap',
    label: 'kernel-migration/LEGACY_MODULE_MAP.md',
    path: 'kernel-migration/LEGACY_MODULE_MAP.md',
  },
  {
    key: 'legacyDecommissionConditions',
    label: 'kernel-migration/LEGACY_DECOMMISSION_CONDITIONS.md',
    path: 'kernel-migration/LEGACY_DECOMMISSION_CONDITIONS.md',
  },
]

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-legacy-module-map-sync.js [--json] [--strict] [--help]',
    '',
    'Checks that legacy module names stay synchronized across migration docs:',
    '  - libs/legacy/MIGRATION_PLAN.md',
    '  - kernel-migration/LEGACY_MODULE_MAP.md',
    '  - kernel-migration/LEGACY_DECOMMISSION_CONDITIONS.md',
    '',
    'Options:',
    '  --json    Print structured JSON only',
    '  --strict  Exit non-zero when mismatches are found',
    '  --help    Show this help',
    '',
    'Exit codes:',
    '  0   docs are synchronized, or non-strict mismatch report',
    '  3   validation failed in strict mode or file/content error',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseArgs(argv) {
  const args = {
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

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function splitLines(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
}

function normalizeModuleName(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function isLegacyModuleName(value) {
  return /^blackcat-[a-z0-9][a-z0-9-]*$/.test(value)
}

function lineLooksRelevant(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/blackcat-templates/i.test(trimmed) && /not from/i.test(trimmed)) return false
  if (trimmed.startsWith('|')) return true
  if (/^#{1,6}\s+/.test(trimmed)) return true
  if (/^(?:Module|module)\s*[:=]/.test(trimmed)) return true
  if (/`blackcat-/.test(trimmed)) return true
  return false
}

function extractModuleNamesFromLine(line) {
  const names = []

  for (const match of line.matchAll(/`([^`]+)`/g)) {
    const value = normalizeModuleName(match[1])
    if (isLegacyModuleName(value)) names.push(value)
  }

  for (const match of line.matchAll(/\b(blackcat-[a-z0-9][a-z0-9-]*)\b/gi)) {
    const value = normalizeModuleName(match[1]).toLowerCase()
    if (isLegacyModuleName(value)) names.push(value)
  }

  return names
}

export function collectLegacyModuleNames(text) {
  const names = new Set()
  for (const line of splitLines(text)) {
    if (!lineLooksRelevant(line)) continue
    for (const name of extractModuleNamesFromLine(line)) {
      names.add(name)
    }
  }
  return [...names].sort()
}

function readText(filePath) {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (err) {
    throw new CliError(`unable to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`, 3)
  }
}

function buildDocSummary(file, modules) {
  return {
    file: file.label,
    path: file.path,
    moduleCount: modules.length,
    modules,
    missing: [],
    extra: [],
  }
}

function setDifference(left, right) {
  const result = []
  for (const item of left) {
    if (!right.has(item)) result.push(item)
  }
  return result.sort()
}

function setIntersectionCount(sets) {
  if (sets.length === 0) return new Set()
  const [first, ...rest] = sets
  const common = new Set(first)
  for (const current of rest) {
    for (const value of [...common]) {
      if (!current.has(value)) common.delete(value)
    }
  }
  return common
}

export function checkLegacyModuleMapSync(options = {}) {
  const cwd = isNonEmptyString(options.cwd) ? options.cwd : process.cwd()
  const docs = Array.isArray(options.docs) && options.docs.length > 0 ? options.docs : DEFAULT_MODULE_DOCS

  const summaries = []
  const sets = []
  const allNames = new Set()

  for (const doc of docs) {
    const filePath = resolve(cwd, doc.path)
    const modules = collectLegacyModuleNames(readText(filePath))
    const moduleSet = new Set(modules)
    summaries.push(buildDocSummary(doc, modules))
    sets.push(moduleSet)
    for (const name of modules) allNames.add(name)
  }

  const common = setIntersectionCount(sets)
  let mismatchCount = 0

  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index]
    const moduleSet = sets[index]
    summary.missing = setDifference(allNames, moduleSet)
    summary.extra = setDifference(moduleSet, common)
    mismatchCount += summary.missing.length + summary.extra.length
  }

  const ok = mismatchCount === 0
  return {
    ok,
    strict: options.strict === true,
    status: ok ? 'ok' : 'mismatch',
    moduleCount: allNames.size,
    commonModules: [...common].sort(),
    documents: summaries,
    mismatchCount,
  }
}

function renderHuman(report) {
  const lines = []
  lines.push('# Legacy Module Map Sync')
  lines.push('')
  lines.push(`- Status: \`${report.status}\``)
  lines.push(`- Strict: \`${report.strict ? 'true' : 'false'}\``)
  lines.push(`- Unique modules: ${report.moduleCount}`)
  lines.push(`- Mismatch count: ${report.mismatchCount}`)
  lines.push('')

  if (report.commonModules.length > 0) {
    lines.push('## Common modules')
    lines.push(`- ${report.commonModules.map((name) => `\`${name}\``).join(', ')}`)
    lines.push('')
  }

  for (const doc of report.documents) {
    lines.push(`## ${doc.file}`)
    lines.push(`- Path: \`${doc.path}\``)
    lines.push(`- Modules: ${doc.modules.length}`)
    if (doc.missing.length > 0) {
      lines.push(`- Missing in this file: ${doc.missing.map((name) => `\`${name}\``).join(', ')}`)
    }
    if (doc.extra.length > 0) {
      lines.push(`- Extra in this file: ${doc.extra.map((name) => `\`${name}\``).join(', ')}`)
    }
    if (doc.missing.length === 0 && doc.extra.length === 0) {
      lines.push('- In sync')
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export function runCli(argv = process.argv.slice(2), options = {}) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
    }

    const report = checkLegacyModuleMapSync({ cwd: options.cwd, strict: args.strict })
    const payload = { ...report, strict: args.strict }

    if (args.json) {
      const stdout = `${JSON.stringify(payload, null, 2)}\n`
      return { exitCode: report.ok || !args.strict ? 0 : 3, stdout, stderr: '' }
    }

    const stdout = renderHuman(payload)
    const exitCode = report.ok || !args.strict ? 0 : 3
    return { exitCode, stdout, stderr: '' }
  } catch (err) {
    if (err instanceof CliError) {
      const stdout = err.message.includes('unable to read') ? `${err.message}\n` : `${usageText()}\n`
      const stderr = err.message.includes('unable to read') ? '' : `${err.message}\n`
      return { exitCode: err.exitCode, stdout, stderr }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 3, stdout: '', stderr: `${message}\n` }
  }
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false

if (isDirectRun) {
  const result = runCli()
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
