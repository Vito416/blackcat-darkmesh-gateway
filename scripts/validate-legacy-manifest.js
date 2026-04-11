#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MANIFEST = 'libs/legacy/MANIFEST.md'
const DEFAULT_LEGACY_DIR = 'libs/legacy'

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
    '  node scripts/validate-legacy-manifest.js [--manifest <path>] [--legacy-dir <path>] [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --manifest <PATH>    Legacy manifest markdown file (default: libs/legacy/MANIFEST.md)',
    '  --legacy-dir <PATH>  Base directory that contains imported legacy modules (default: libs/legacy)',
    '  --json               Print structured JSON only',
    '  --strict             Exit 3 when integrity issues are found',
    '  --help               Show this help',
    '',
    'Exit codes:',
    '  0   validation passed, or issues were reported without --strict',
    '  3   validation issues found in --strict mode',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function stripInlineCode(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.replace(/^`+/, '').replace(/`+$/, '').trim()
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    legacyDir: DEFAULT_LEGACY_DIR,
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
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--manifest':
        args.manifest = readValue()
        break
      case '--legacy-dir':
        args.legacyDir = readValue()
        break
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  return args
}

function parseManifestModules(markdown) {
  if (!isNonEmptyString(markdown)) {
    return []
  }

  const modules = []
  const lines = markdown.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      continue
    }

    const cells = trimmed
      .slice(1)
      .split('|')
      .map((cell) => cell.trim())

    if (cells.length < 2) {
      continue
    }

    const moduleName = stripInlineCode(cells[0])
    const sourceCommit = stripInlineCode(cells[1])
    const normalized = moduleName.toLowerCase()

    if (!moduleName || normalized === 'module' || normalized === 'source commit' || /^-+$/.test(moduleName)) {
      continue
    }

    modules.push({
      moduleName,
      sourceCommit,
      row: trimmed,
    })
  }

  return modules
}

function hasCommitishMarker(text) {
  if (!isNonEmptyString(text)) {
    return false
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^[0-9a-f]{7,40}$/i.test(line)) {
      return true
    }
    if (/(?:commit|source commit|source|hash|revision|rev)\b/i.test(line) && /[0-9a-f]{7,40}/i.test(line)) {
      return true
    }
  }

  return false
}

function fileState(filePath) {
  try {
    const stat = statSync(filePath)
    return { exists: stat.isFile() }
  } catch (_) {
    return { exists: false }
  }
}

function inspectLegacyModule(moduleName, legacyDir) {
  const modulePath = join(legacyDir, moduleName)
  const missingItems = []

  try {
    const stat = statSync(modulePath)
    if (!stat.isDirectory()) {
      return {
        moduleName,
        modulePath,
        missingItems: ['directory'],
        ok: false,
      }
    }
  } catch (_) {
    return {
      moduleName,
      modulePath,
      missingItems: ['directory'],
      ok: false,
    }
  }

  const importSourcePath = join(modulePath, '.import-source')
  const importSource = fileState(importSourcePath)
  let importSourceText = ''

  if (!importSource.exists) {
    missingItems.push('.import-source')
  } else {
    importSourceText = readFileSync(importSourcePath, 'utf8')
    if (!hasCommitishMarker(importSourceText)) {
      missingItems.push('.import-source missing commit-ish line or hash marker')
    }
  }

  for (const filename of ['LICENSE', 'README.md']) {
    if (!fileState(join(modulePath, filename)).exists) {
      missingItems.push(filename)
    }
  }

  return {
    moduleName,
    modulePath,
    importSourceText,
    missingItems,
    ok: missingItems.length === 0,
  }
}

function validateLegacyImportIntegrity(manifestText, { legacyDir = DEFAULT_LEGACY_DIR } = {}) {
  const moduleEntries = parseManifestModules(manifestText)
  const modules = moduleEntries.map((entry) => ({
    ...entry,
    ...inspectLegacyModule(entry.moduleName, legacyDir),
  }))

  const missingItems = modules
    .filter((module) => !module.ok)
    .map((module) => ({
      module: module.moduleName,
      missingItems: module.missingItems,
    }))

  const globalIssues = []
  if (moduleEntries.length === 0) {
    globalIssues.push('no module rows found in MANIFEST.md table')
  }

  return {
    status: missingItems.length === 0 && globalIssues.length === 0 ? 'pass' : 'issues-found',
    moduleCount: moduleEntries.length,
    okCount: modules.filter((module) => module.ok).length,
    issueCount: missingItems.length + globalIssues.length,
    issues: globalIssues,
    missingItems,
    modules,
  }
}

function renderHumanSummary(result, { manifest, legacyDir }) {
  const lines = []
  if (result.status === 'pass') {
    lines.push('Legacy import integrity passed')
  } else {
    lines.push('Legacy import integrity issues found')
  }
  lines.push(`Manifest: ${manifest}`)
  lines.push(`Legacy dir: ${legacyDir}`)
  lines.push(`Modules parsed: ${result.moduleCount}`)
  lines.push(`Problem modules: ${result.missingItems.length}`)
  lines.push(`Issues found: ${result.issueCount}`)

  for (const issue of result.issues) {
    lines.push(`- manifest: ${issue}`)
  }

  for (const module of result.missingItems) {
    lines.push(`- ${module.module}: ${module.missingItems.join(', ')}`)
  }

  return `${lines.join('\n')}\n`
}

function renderJsonSummary(result, { manifest, legacyDir, strict }) {
  return JSON.stringify(
    {
      status: result.status,
      manifest,
      legacyDir,
      strict,
      moduleCount: result.moduleCount,
      okCount: result.okCount,
      issueCount: result.issueCount,
      issues: result.issues,
      missingItems: result.missingItems,
      modules: result.modules.map((module) => ({
        module: module.moduleName,
        modulePath: module.modulePath,
        sourceCommit: module.sourceCommit,
        ok: module.ok,
        missingItems: module.missingItems,
      })),
    },
    null,
    2,
  )
}

function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: `${usageText()}\n`, stderr: `error: ${err.message}\n` }
    }
    return {
      exitCode: 64,
      stdout: `${usageText()}\n`,
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  if (args.help) {
    return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
  }

  let manifestText
  try {
    manifestText = readFileSync(args.manifest, 'utf8')
  } catch (err) {
    return {
      exitCode: 64,
      stdout: `${usageText()}\n`,
      stderr: `error: unable to read manifest: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  const result = validateLegacyImportIntegrity(manifestText, { legacyDir: args.legacyDir })
  const exitCode = result.status === 'pass' || !args.strict ? 0 : 3
  const stdout = args.json
    ? `${renderJsonSummary(result, args)}\n`
    : renderHumanSummary(result, args)

  return {
    exitCode,
    stdout,
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
  hasCommitishMarker,
  inspectLegacyModule,
  parseArgs,
  parseManifestModules,
  renderHumanSummary,
  renderJsonSummary,
  runCli,
  usageText,
  validateLegacyImportIntegrity,
}
