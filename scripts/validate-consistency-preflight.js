#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const VALID_MODES = new Set(['pairwise', 'all'])
const VALID_PROFILES = new Set(['wedos_small', 'wedos_medium', 'diskless'])
const VALID_PROTOCOLS = new Set(['http:', 'https:'])

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
    '  node scripts/validate-consistency-preflight.js --urls <csv> [--mode pairwise|all] [--profile wedos_small|wedos_medium|diskless] [--token <value>] [--allow-anon] [--json]',
    '',
    'Options:',
    '  --urls <CSV>        Comma-separated gateway URLs (required, at least two)',
    '  --mode <MODE>       pairwise (default) or all',
    '  --profile <NAME>    wedos_small|wedos_medium|diskless (default: wedos_medium)',
    '  --token <VALUE>     Optional integrity state token',
    '  --allow-anon        Allow public state endpoints without a token',
    '  --json              Print structured JSON only',
    '  --help              Show this help',
    '',
    'Exit codes:',
    '  0   preflight passed',
    '  3   blocking validation issue',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseCsvUrls(raw) {
  if (!isNonEmptyString(raw)) {
    throw new CliError('--urls must not be blank')
  }

  return raw.split(',').map((entry) => entry.trim())
}

function validateUrlList(urls) {
  const issues = []
  let validCount = 0

  if (!Array.isArray(urls)) {
    return ['--urls must be a comma-separated list']
  }

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    if (!isNonEmptyString(url)) {
      issues.push(`--urls[${index + 1}] must not be blank`)
      continue
    }

    try {
      const parsed = new URL(url)
      if (!VALID_PROTOCOLS.has(parsed.protocol)) {
        issues.push(`--urls[${index + 1}] must use http(s): ${url}`)
        continue
      }
      validCount += 1
    } catch (_) {
      issues.push(`--urls[${index + 1}] must be a valid http(s) URL: ${url}`)
    }
  }

  if (validCount < 2) {
    issues.push('--urls must contain at least two valid http(s) URLs')
  }

  return issues
}

function parseArgs(argv) {
  const args = {
    urls: '',
    mode: 'pairwise',
    profile: 'wedos_medium',
    token: '',
    allowAnon: false,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true }
    }

    if (arg === '--allow-anon') {
      args.allowAnon = true
      continue
    }

    if (arg === '--json') {
      args.json = true
      continue
    }

    const next = argv[index + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--urls':
        args.urls = readValue()
        break
      case '--mode':
        args.mode = readValue()
        break
      case '--profile':
        args.profile = readValue()
        break
      case '--token':
        args.token = readValue()
        break
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.urls)) {
    throw new CliError('--urls is required', 64)
  }

  return args
}

function validatePreflightConfig(args) {
  const issues = []
  const urls = parseCsvUrls(args.urls)

  issues.push(...validateUrlList(urls))

  const mode = args.mode.trim().toLowerCase()
  if (!VALID_MODES.has(mode)) {
    issues.push(`unsupported --mode value: ${args.mode}`)
  }

  const profile = args.profile.trim().toLowerCase()
  if (!VALID_PROFILES.has(profile)) {
    issues.push(`unsupported --profile value: ${args.profile}`)
  }

  const tokenPresent = isNonEmptyString(args.token)
  if (!args.allowAnon && !tokenPresent) {
    issues.push('--token is required unless --allow-anon is set')
  }

  return {
    urls,
    mode,
    profile,
    allowAnon: args.allowAnon,
    tokenPresent,
    issues,
    ok: issues.length === 0,
    exitCode: issues.length === 0 ? 0 : 3,
  }
}

function renderHumanResult(result) {
  if (result.ok) {
    return [
      'Consistency preflight passed',
      `URLs: ${result.urls.length}`,
      `Mode: ${result.mode}`,
      `Profile: ${result.profile}`,
      `Auth: ${result.allowAnon ? 'anonymous allowed' : result.tokenPresent ? 'token provided' : 'token required'}`,
    ].join('\n')
  }

  return [
    'Consistency preflight failed',
    ...result.issues.map((issue) => `- ${issue}`),
  ].join('\n')
}

function renderJsonResult(result) {
  return JSON.stringify(result, null, 2)
}

async function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, error: err.message, usage: usageText() }
    }
    return { exitCode: 64, error: err instanceof Error ? err.message : String(err), usage: usageText() }
  }

  if (args.help) {
    return { exitCode: 0, usage: usageText() }
  }

  try {
    const result = validatePreflightConfig(args)
    return {
      exitCode: result.exitCode,
      output: args.json ? renderJsonResult(result) : renderHumanResult(result),
      result,
    }
  } catch (err) {
    return {
      exitCode: err instanceof CliError ? err.exitCode : 3,
      error: err instanceof Error ? err.message : String(err),
      usage: usageText(),
    }
  }
}

async function main() {
  const result = await runCli(process.argv.slice(2))

  if (result.usage && result.exitCode === 0) {
    console.log(result.usage)
    process.exit(0)
  }

  if (typeof result.output === 'string') {
    console.log(result.output)
    process.exit(result.exitCode)
  }

  if (typeof result.error === 'string') {
    console.error(`error: ${result.error}`)
    if (result.usage) {
      console.log(result.usage)
    }
    process.exit(result.exitCode)
  }

  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(64)
  })
}

export { parseArgs, renderHumanResult, renderJsonResult, runCli, validatePreflightConfig, usageText }
