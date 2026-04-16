#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

const ENV_VAR = 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP'

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-template-signature-ref-map.js [--require-sites <csv>] [--json] [--strict] [--help]',
    '',
    'Environment:',
    `  ${ENV_VAR}   JSON object mapping site keys to signature ref strings`,
    '',
    'Options:',
    '  --require-sites <CSV>  Comma-separated list of required site keys',
    '  --json                 Print structured JSON only',
    '  --strict               Fail when required sites are missing',
    '  --help                 Show this help',
    '',
    'Exit codes:',
    '  0   validation passed or pending without --strict',
    '  3   malformed map, missing required sites in --strict mode, or runtime error',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseRequireSites(value) {
  if (!isNonEmptyString(value)) {
    throw new CliError('--require-sites must not be blank', 64)
  }

  const sites = value
    .split(',')
    .map((site) => site.trim())
    .filter((site) => site.length > 0)

  if (sites.length === 0) {
    throw new CliError('--require-sites must contain at least one site key', 64)
  }

  return [...new Set(sites)]
}

function parseSignatureRefMap(rawValue, label = ENV_VAR) {
  if (!isNonEmptyString(rawValue)) {
    return { ok: false, issues: [`${label} is not set`], map: null }
  }

  let parsed
  try {
    parsed = JSON.parse(rawValue)
  } catch (error) {
    return {
      ok: false,
      issues: [`${label} must be valid JSON (${error instanceof Error ? error.message : String(error)})`],
      map: null,
    }
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      issues: [`${label} must be a JSON object`],
      map: null,
    }
  }

  return { ok: true, issues: [], map: parsed }
}

function validateSignatureRefMap(signatureRefMap, options = {}) {
  const strict = options.strict === true
  const requiredSites = Array.isArray(options.requiredSites) ? [...new Set(options.requiredSites)] : []
  const issues = []
  const warnings = []
  const normalized = {}

  if (!isObject(signatureRefMap)) {
    return {
      ok: false,
      status: 'blocked',
      strict,
      envVar: ENV_VAR,
      requiredSites,
      providedSites: [],
      missingSites: [...requiredSites],
      counts: {
        providedCount: 0,
        requiredCount: requiredSites.length,
        missingCount: requiredSites.length,
        emptyValueCount: 0,
      },
      issues: [`${ENV_VAR} must be a JSON object`],
      warnings: [],
      map: null,
    }
  }

  let emptyValueCount = 0
  for (const [key, value] of Object.entries(signatureRefMap)) {
    if (!isNonEmptyString(key)) {
      issues.push('signature ref map keys must be non-empty strings')
      continue
    }
    if (!isNonEmptyString(value)) {
      emptyValueCount += 1
      issues.push(`signature ref map entry ${key} must be a non-empty string`)
      continue
    }
    normalized[key] = value.trim()
  }

  const providedSites = Object.keys(normalized)
  const missingSites = requiredSites.filter((site) => !providedSites.includes(site))

  let status = 'complete'

  if (issues.length > 0) {
    status = 'blocked'
  } else if (missingSites.length > 0) {
    if (strict) {
      status = 'blocked'
      issues.push(`missing signature refs for: ${missingSites.join(', ')}`)
    } else {
      status = 'pending'
      warnings.push(`missing signature refs for: ${missingSites.join(', ')}`)
    }
  }

  return {
    ok: status === 'complete',
    status,
    strict,
    envVar: ENV_VAR,
    requiredSites,
    providedSites,
    missingSites,
    counts: {
      providedCount: providedSites.length,
      requiredCount: requiredSites.length,
      missingCount: missingSites.length,
      emptyValueCount,
    },
    issues,
    warnings,
    map: normalized,
  }
}

function formatHuman(result) {
  const lines = [
    `Status: \`${result.status}\``,
    `Env var: ${result.envVar}`,
    `Provided sites: ${result.counts.providedCount}`,
    `Required sites: ${result.counts.requiredCount}`,
    `Missing sites: ${result.missingSites.length > 0 ? result.missingSites.join(', ') : 'none'}`,
    `Empty values: ${result.counts.emptyValueCount}`,
  ]

  if (result.issues.length > 0) {
    lines.push('Issues:')
    for (const issue of result.issues) {
      lines.push(`- ${issue}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  return lines.join('\n')
}

function parseArgs(argv) {
  const args = {
    json: false,
    strict: false,
    help: false,
    requireSites: [],
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

    if (arg === '--require-sites' || arg.startsWith('--require-sites=')) {
      const value = arg === '--require-sites' ? readValue() : arg.slice('--require-sites='.length)
      args.requireSites = parseRequireSites(value)
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }

    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function runCli(argv = process.argv.slice(2), env = process.env) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: usageText(), stderr: '' }
    }

    const parsed = parseSignatureRefMap(env[ENV_VAR])
    if (!parsed.ok) {
      const result = {
        ok: false,
        status: 'blocked',
        strict: args.strict,
        envVar: ENV_VAR,
        requiredSites: args.requireSites,
        providedSites: [],
        missingSites: [],
        counts: {
          providedCount: 0,
          requiredCount: args.requireSites.length,
          missingCount: 0,
          emptyValueCount: 0,
        },
        issues: [...parsed.issues],
        warnings: [],
        map: null,
      }
      return args.json
        ? {
            exitCode: 3,
            stdout: `${JSON.stringify(result, null, 2)}\n`,
            stderr: `blocked: ${parsed.issues.join('; ')}\n`,
          }
        : {
            exitCode: 3,
            stdout: `${formatHuman(result)}\n`,
            stderr: `blocked: ${parsed.issues.join('; ')}\n`,
          }
    }

    const result = validateSignatureRefMap(parsed.map, {
      strict: args.strict,
      requiredSites: args.requireSites,
    })

    const exitCode = result.status === 'blocked' ? 3 : 0

    if (args.json) {
      return {
        exitCode,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: '',
      }
    }

    return {
      exitCode,
      stdout: `${formatHuman(result)}\n`,
      stderr: '',
    }
  } catch (error) {
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: `${usageText()}\n`,
        stderr: `${error.message}\n`,
      }
    }

    return {
      exitCode: 3,
      stdout: '',
      stderr: `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    }
  }
}

async function main() {
  const result = runCli(process.argv.slice(2), process.env)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exit(3)
  })
}

export {
  formatHuman,
  parseArgs,
  parseRequireSites,
  parseSignatureRefMap,
  runCli,
  validateSignatureRefMap,
}
