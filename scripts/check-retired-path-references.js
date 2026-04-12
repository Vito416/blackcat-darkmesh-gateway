#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_ROOT = '.'
const DEFAULT_TARGETS = Object.freeze(['.github/workflows', 'scripts', 'package.json'])
const DEFAULT_EXCLUDED_FILES = new Set(['scripts/check-retired-path-references.js'])
const RETIRED_PATTERNS = Object.freeze([
  { path: 'kernel-migration/', replacement: 'ops/decommission/' },
  { path: 'security/crypto-manifests/', replacement: 'security/crypto-policy/' },
])

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
    '  node scripts/check-retired-path-references.js [--root <DIR>] [--target <PATH>] [--json] [--strict] [--help]',
    '',
    'Options:',
    `  --root <DIR>      Repository root to scan (default: ${DEFAULT_ROOT})`,
    '  --target <PATH>   Relative file/dir to scan; repeatable (default scans .github/workflows, scripts, package.json)',
    '  --json            Emit machine-readable JSON',
    '  --strict          Exit 3 when retired references are found',
    '  --help            Show this help',
    '',
    'Retired patterns:',
    ...RETIRED_PATTERNS.map((entry) => `  - ${entry.path} -> use ${entry.replacement}`),
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    targets: [],
    json: false,
    strict: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      throw new CliError('help requested', 0)
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
      case '--root':
        args.root = readValue()
        break
      case '--target':
        args.targets.push(readValue())
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  return args
}

function shouldScanFile(path) {
  return /\.(yml|yaml|json|js|mjs|cjs|ts|sh|md|txt)$/i.test(path)
}

function collectFiles(entryPath) {
  const files = []
  let stats
  try {
    stats = statSync(entryPath)
  } catch (_) {
    return files
  }

  if (stats.isFile()) {
    if (shouldScanFile(entryPath)) files.push(entryPath)
    return files
  }

  if (!stats.isDirectory()) return files

  const stack = [entryPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const entry of entries) {
      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(nextPath)
        continue
      }
      if (entry.isFile() && shouldScanFile(nextPath)) files.push(nextPath)
    }
  }

  return files
}

function scanRetiredPathReferences(options = {}) {
  const root = resolve(options.root || DEFAULT_ROOT)
  const targets = Array.isArray(options.targets) && options.targets.length > 0 ? options.targets : [...DEFAULT_TARGETS]

  const files = []
  for (const target of targets) {
    files.push(...collectFiles(resolve(root, target)))
  }

  const uniqueFiles = [...new Set(files)]
  const findings = []

  for (const filePath of uniqueFiles) {
    const relPath = relative(root, filePath).replace(/\\/g, '/')
    if (DEFAULT_EXCLUDED_FILES.has(relPath)) continue
    let text = ''
    try {
      text = readFileSync(filePath, 'utf8')
    } catch (_) {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      for (const pattern of RETIRED_PATTERNS) {
        if (!line.includes(pattern.path)) continue
        findings.push({
          file: relPath,
          line: index + 1,
          column: line.indexOf(pattern.path) + 1,
          retiredPath: pattern.path,
          replacement: pattern.replacement,
          text: line.trim(),
        })
      }
    }
  }

  return {
    status: findings.length === 0 ? 'pass' : 'fail',
    root,
    targetCount: targets.length,
    scannedFileCount: uniqueFiles.length,
    findingCount: findings.length,
    findings,
  }
}

function renderHuman(summary) {
  const lines = []
  lines.push('# Retired Path Reference Check')
  lines.push('')
  lines.push(`- Status: ${summary.status.toUpperCase()}`)
  lines.push(`- Scanned files: ${summary.scannedFileCount}`)
  lines.push(`- Findings: ${summary.findingCount}`)
  if (summary.findings.length > 0) {
    lines.push('')
    lines.push('## Findings')
    for (const finding of summary.findings) {
      lines.push(
        `- ${finding.file}:${finding.line}:${finding.column} uses ${finding.retiredPath} (use ${finding.replacement})`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    const summary = scanRetiredPathReferences({ root: args.root, targets: args.targets })
    return {
      exitCode: args.strict && summary.findingCount > 0 ? 3 : 0,
      stdout: args.json ? `${JSON.stringify(summary, null, 2)}\n` : renderHuman(summary),
      stderr: '',
      summary,
    }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.exitCode === 0) {
        return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
      }
      return { exitCode: err.exitCode, stdout: `${usageText()}\n`, stderr: `error: ${err.message}\n` }
    }
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
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

export { DEFAULT_TARGETS, RETIRED_PATTERNS, parseArgs, runCli, scanRetiredPathReferences, usageText }
