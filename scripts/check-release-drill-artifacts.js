#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_FILES = [
  'consistency-matrix.json',
  'consistency-drift-report.md',
  'consistency-drift-summary.json',
  'latest-evidence-bundle.json',
  'ao-dependency-gate.validation.txt',
  'release-evidence-pack.md',
  'release-evidence-pack.json',
  'release-signoff-checklist.md',
  'release-readiness.json',
  'release-drill-checks.json',
  'release-drill-manifest.json',
  'release-drill-manifest.validation.txt',
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
    '  node scripts/check-release-drill-artifacts.js --dir <DIR> [--strict] [--json] [--help]',
    '',
    'Options:',
    '  --dir <DIR>   Release-drill artifact directory (required)',
    '  --strict      Run deep cross-file consistency checks',
    '  --json        Print JSON output (human text by default)',
    '  --help        Show this help',
    '',
    'Exit codes:',
    '  0   artifact set is valid',
    '  3   missing or invalid drill artifacts',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    dir: '',
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
      case '--dir':
        args.dir = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir is required', 64)
  return args
}

function safeReadJson(path, label, issues) {
  try {
    const content = readFileSync(path, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    issues.push(`${label} is not valid JSON`)
    return null
  }
}

function validateStrict(summary, strictChecks) {
  const { dir, issues } = summary
  const manifestPath = join(dir, 'release-drill-manifest.json')
  const readinessPath = join(dir, 'release-readiness.json')
  const packPath = join(dir, 'release-evidence-pack.json')
  const validationPath = join(dir, 'release-drill-manifest.validation.txt')
  const aoGateValidationPath = join(dir, 'ao-dependency-gate.validation.txt')

  const manifest = safeReadJson(manifestPath, 'release-drill-manifest.json', issues)
  const readiness = safeReadJson(readinessPath, 'release-readiness.json', issues)
  const pack = safeReadJson(packPath, 'release-evidence-pack.json', issues)

  if (manifest) {
    if (!isNonEmptyString(manifest.release)) issues.push('release-drill-manifest.json is missing non-empty release')
    if (!isNonEmptyString(manifest.status)) issues.push('release-drill-manifest.json is missing non-empty status')
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
      issues.push('release-drill-manifest.json is missing artifacts[]')
    }
  }

  if (readiness && pack) {
    const readinessRelease = isNonEmptyString(readiness.release) ? readiness.release.trim() : ''
    const packRelease = isNonEmptyString(pack.release) ? pack.release.trim() : ''
    if (readinessRelease && packRelease && readinessRelease !== packRelease) {
      issues.push(`release mismatch: readiness=${readinessRelease} pack=${packRelease}`)
    }
    if (manifest && isNonEmptyString(manifest.release)) {
      const manifestRelease = manifest.release.trim()
      if (packRelease && manifestRelease !== packRelease) {
        issues.push(`release mismatch: manifest=${manifestRelease} pack=${packRelease}`)
      }
      if (readinessRelease && manifestRelease !== readinessRelease) {
        issues.push(`release mismatch: manifest=${manifestRelease} readiness=${readinessRelease}`)
      }
    }
  }

  try {
    const validateText = readFileSync(validationPath, 'utf8')
    if (!validateText.toLowerCase().includes('valid release drill manifest')) {
      issues.push('release-drill-manifest.validation.txt does not confirm valid release drill manifest')
    }
  } catch (_) {
    issues.push('release-drill-manifest.validation.txt is unreadable')
  }

  try {
    const aoGateValidationText = readFileSync(aoGateValidationPath, 'utf8')
    if (!aoGateValidationText.toLowerCase().includes('valid dependency gate')) {
      issues.push('ao-dependency-gate.validation.txt does not confirm valid dependency gate')
    }
  } catch (_) {
    issues.push('ao-dependency-gate.validation.txt is unreadable')
  }

  strictChecks.performed = true
}

function checkReleaseDrillArtifacts(dir, options = {}) {
  const resolvedDir = resolve(dir)
  const strict = options.strict === true
  const missing = []
  const files = []
  const issues = []
  const strictChecks = { performed: false }

  for (const name of REQUIRED_FILES) {
    const path = join(resolvedDir, name)
    try {
      const info = statSync(path)
      if (!info.isFile()) {
        missing.push(name)
      } else {
        files.push({ name, path, sizeBytes: info.size })
      }
    } catch (_) {
      missing.push(name)
    }
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    dir: resolvedDir,
    strict,
    requiredCount: REQUIRED_FILES.length,
    presentCount: files.length,
    missing,
    issues,
    files,
    strictChecks,
  }

  if (strict && missing.length === 0) {
    validateStrict(summary, strictChecks)
  }

  summary.ok = summary.missing.length === 0 && summary.issues.length === 0
  return summary
}

function renderHuman(summary) {
  const lines = []
  lines.push('# Release Drill Artifact Check')
  lines.push('')
  lines.push(`- Directory: \`${summary.dir}\``)
  lines.push(`- Strict: ${summary.strict ? 'yes' : 'no'}`)
  lines.push(`- Required files: ${summary.requiredCount}`)
  lines.push(`- Present files: ${summary.presentCount}`)
  lines.push(`- Missing files: ${summary.missing.length}`)
  lines.push(`- Issues: ${summary.issues.length}`)
  lines.push(`- Result: ${summary.ok ? 'OK' : 'ERROR'}`)
  if (summary.missing.length > 0) {
    lines.push('')
    lines.push('Missing:')
    for (const name of summary.missing) lines.push(`- ${name}`)
  }
  if (summary.issues.length > 0) {
    lines.push('')
    lines.push('Issues:')
    for (const issue of summary.issues) lines.push(`- ${issue}`)
  }
  lines.push('')
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

  if (args.help) return { exitCode: 0, stdout: usageText(), stderr: '' }

  const summary = checkReleaseDrillArtifacts(args.dir, { strict: args.strict })
  return {
    exitCode: summary.ok ? 0 : 3,
    stdout: args.json ? `${JSON.stringify(summary, null, 2)}\n` : renderHuman(summary),
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

export { CliError, REQUIRED_FILES, checkReleaseDrillArtifacts, parseArgs, runCli, usageText }
