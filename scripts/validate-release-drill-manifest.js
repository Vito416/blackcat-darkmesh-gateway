#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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
    '  node scripts/validate-release-drill-manifest.js --file <FILE> [--strict] [--help]',
    '',
    'Options:',
    '  --file <FILE>   Manifest JSON file to validate (required)',
    '  --strict        Require unique artifact paths and lowercase sha256 hex',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   valid manifest',
    '  3   invalid manifest',
    '  64  usage error',
  ].join('\n')
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseArgs(argv) {
  const args = {
    file: '',
    strict: false,
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
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (typeof args.file !== 'string' || args.file.trim().length === 0) {
    throw new CliError('--file is required', 64)
  }

  return args
}

function validateManifest(manifest, { strict = false } = {}) {
  const issues = []

  if (!isObject(manifest)) {
    return { ok: false, issues: ['manifest must be a JSON object'] }
  }

  if (typeof manifest.createdAt !== 'string') {
    issues.push('createdAt must be a string')
  }

  if (typeof manifest.drillDir !== 'string') {
    issues.push('drillDir must be a string')
  }

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    issues.push('artifacts must be a non-empty array')
    return { ok: issues.length === 0, issues }
  }

  const seenPaths = new Set()

  for (let index = 0; index < manifest.artifacts.length; index += 1) {
    const artifact = manifest.artifacts[index]
    const label = `artifacts[${index + 1}]`

    if (!isObject(artifact)) {
      issues.push(`${label} must be an object`)
      continue
    }

    if (typeof artifact.path !== 'string') {
      issues.push(`${label}.path must be a string`)
    } else if (strict) {
      if (seenPaths.has(artifact.path)) {
        issues.push(`${label}.path must be unique in --strict mode`)
      } else {
        seenPaths.add(artifact.path)
      }
    }

    if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
      issues.push(`${label}.sizeBytes must be an integer >= 0`)
    }

    if (typeof artifact.sha256 !== 'string') {
      issues.push(`${label}.sha256 must be a string`)
    } else if (!/^[0-9a-fA-F]{64}$/.test(artifact.sha256)) {
      issues.push(`${label}.sha256 must be a 64-character hex string`)
    } else if (strict && !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      issues.push(`${label}.sha256 must use lowercase hex in --strict mode`)
    }
  }

  return { ok: issues.length === 0, issues }
}

function renderValidationResult(filePath, result) {
  if (result.ok) {
    return `valid release drill manifest: ${filePath}\n`
  }

  return [
    'invalid release drill manifest:',
    ...result.issues.map((issue) => `- ${issue}`),
    '',
  ].join('\n')
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

  let text
  try {
    text = readFileSync(args.file, 'utf8')
  } catch (err) {
    return {
      exitCode: 64,
      stdout: usageText(),
      stderr: `error: unable to read file: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (err) {
    return {
      exitCode: 3,
      stdout: `invalid release drill manifest: malformed JSON (${err instanceof Error ? err.message : String(err)})\n`,
      stderr: '',
    }
  }

  const result = validateManifest(manifest, { strict: args.strict })
  return {
    exitCode: result.ok ? 0 : 3,
    stdout: renderValidationResult(args.file, result),
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

export { CliError, parseArgs, runCli, usageText, validateManifest }
