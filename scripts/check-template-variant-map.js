#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

export const ENV_VAR = 'GATEWAY_TEMPLATE_VARIANT_MAP'
const DEFAULT_ALLOWED_VARIANTS = ['signal', 'bastion', 'horizon']

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-template-variant-map.js [--require-sites <csv>] [--allow-variants <csv>] [--json] [--strict] [--help]',
    '',
    'Environment:',
    `  ${ENV_VAR}   JSON object mapping site keys to {variant,templateTxId,manifestTxId}`,
    '',
    'Options:',
    '  --require-sites <CSV>   Comma-separated list of required site keys',
    `  --allow-variants <CSV> Allowed variant names (default: ${DEFAULT_ALLOWED_VARIANTS.join(',')})`,
    '  --json                  Print structured JSON only',
    '  --strict                Fail when map is missing or required sites are missing',
    '  --help                  Show this help',
    '',
    'Exit codes:',
    '  0   validation passed or pending without --strict',
    '  3   blocked / malformed / strict failure',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseCsv(value, flagName) {
  if (!isNonEmptyString(value)) {
    throw new CliError(`${flagName} must not be blank`, 64)
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (items.length === 0) {
    throw new CliError(`${flagName} must contain at least one value`, 64)
  }

  return [...new Set(items)]
}

function parseArgs(argv) {
  const args = {
    strict: false,
    json: false,
    help: false,
    requireSites: [],
    allowVariants: [...DEFAULT_ALLOWED_VARIANTS],
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
      args.requireSites = parseCsv(value, '--require-sites')
      continue
    }

    if (arg === '--allow-variants' || arg.startsWith('--allow-variants=')) {
      const value = arg === '--allow-variants' ? readValue() : arg.slice('--allow-variants='.length)
      args.allowVariants = parseCsv(value, '--allow-variants')
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function parseMap(rawMap) {
  if (!isNonEmptyString(rawMap)) {
    return {
      ok: false,
      issues: [`${ENV_VAR} is not set`],
      map: null,
    }
  }

  let parsed
  try {
    parsed = JSON.parse(rawMap)
  } catch (error) {
    return {
      ok: false,
      issues: [`${ENV_VAR} must be valid JSON (${error instanceof Error ? error.message : String(error)})`],
      map: null,
    }
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      issues: [`${ENV_VAR} must be a JSON object`],
      map: null,
    }
  }

  return { ok: true, issues: [], map: parsed }
}

export function assessTemplateVariantMap({
  variantMap,
  strict = false,
  requireSites = [],
  allowVariants = DEFAULT_ALLOWED_VARIANTS,
}) {
  const issues = []
  const warnings = []
  const normalizedMap = {}
  const allowed = [...new Set(allowVariants)]

  if (!isObject(variantMap)) {
    return {
      ok: false,
      status: 'blocked',
      strict,
      envVar: ENV_VAR,
      requiredSites: [...requireSites],
      allowedVariants: allowed,
      providedSites: [],
      missingSites: [...requireSites],
      counts: {
        providedCount: 0,
        requiredCount: requireSites.length,
        missingCount: requireSites.length,
      },
      issues: [`${ENV_VAR} must be a JSON object`],
      warnings: [],
      map: null,
    }
  }

  for (const [siteId, entry] of Object.entries(variantMap)) {
    if (!isNonEmptyString(siteId)) {
      issues.push('site keys must be non-empty strings')
      continue
    }
    if (!isObject(entry)) {
      issues.push(`entry ${siteId} must be an object`)
      continue
    }

    const variant = typeof entry.variant === 'string' ? entry.variant.trim() : ''
    const templateTxId = typeof entry.templateTxId === 'string' ? entry.templateTxId.trim() : ''
    const manifestTxId = typeof entry.manifestTxId === 'string' ? entry.manifestTxId.trim() : ''

    if (!variant) {
      issues.push(`entry ${siteId} is missing variant`)
      continue
    }
    if (allowed.length > 0 && !allowed.includes(variant)) {
      issues.push(`entry ${siteId} has unsupported variant ${variant}`)
      continue
    }
    if (!templateTxId) {
      issues.push(`entry ${siteId} is missing templateTxId`)
      continue
    }
    if (!manifestTxId) {
      issues.push(`entry ${siteId} is missing manifestTxId`)
      continue
    }

    normalizedMap[siteId] = {
      variant,
      templateTxId,
      manifestTxId,
    }
  }

  const providedSites = Object.keys(normalizedMap)
  const required = [...new Set(requireSites)]
  const missingSites = required.filter((siteId) => !providedSites.includes(siteId))

  let status = 'complete'
  if (issues.length > 0) {
    status = 'blocked'
  } else if (missingSites.length > 0) {
    if (strict) {
      status = 'blocked'
      issues.push(`missing required sites: ${missingSites.join(', ')}`)
    } else {
      status = 'pending'
      warnings.push(`missing required sites: ${missingSites.join(', ')}`)
    }
  }

  return {
    ok: status === 'complete',
    status,
    strict,
    envVar: ENV_VAR,
    requiredSites: required,
    allowedVariants: allowed,
    providedSites,
    missingSites,
    counts: {
      providedCount: providedSites.length,
      requiredCount: required.length,
      missingCount: missingSites.length,
    },
    issues,
    warnings,
    map: normalizedMap,
  }
}

function formatHuman(result) {
  const lines = [
    `Status: \`${result.status}\``,
    `Env var: ${result.envVar}`,
    `Provided sites: ${result.counts.providedCount}`,
    `Required sites: ${result.counts.requiredCount}`,
    `Allowed variants: ${result.allowedVariants.join(', ')}`,
    `Missing sites: ${result.missingSites.length ? result.missingSites.join(', ') : 'none'}`,
  ]
  if (result.issues.length > 0) {
    lines.push('Issues:')
    for (const issue of result.issues) lines.push(`- ${issue}`)
  }
  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }
  return lines.join('\n')
}

export function runCli(argv = process.argv.slice(2), env = process.env) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: usageText(), stderr: '' }
    }

    const parsed = parseMap(env[ENV_VAR])
    if (!parsed.ok) {
      const result = {
        ok: false,
        status: args.strict ? 'blocked' : 'pending',
        strict: args.strict,
        envVar: ENV_VAR,
        requiredSites: args.requireSites,
        allowedVariants: args.allowVariants,
        providedSites: [],
        missingSites: args.requireSites,
        counts: {
          providedCount: 0,
          requiredCount: args.requireSites.length,
          missingCount: args.requireSites.length,
        },
        issues: args.strict ? parsed.issues : [],
        warnings: args.strict ? [] : parsed.issues,
        map: null,
      }
      if (args.json) {
        return {
          exitCode: args.strict ? 3 : 0,
          stdout: `${JSON.stringify(result, null, 2)}\n`,
          stderr: '',
        }
      }
      return {
        exitCode: args.strict ? 3 : 0,
        stdout: args.strict ? '' : `${formatHuman(result)}\n`,
        stderr: args.strict ? `blocked: ${parsed.issues.join('; ')}\n` : '',
      }
    }

    const result = assessTemplateVariantMap({
      variantMap: parsed.map,
      strict: args.strict,
      requireSites: args.requireSites,
      allowVariants: args.allowVariants,
    })

    const exitCode = result.status === 'blocked' ? 3 : 0
    if (args.json) {
      return { exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' }
    }
    if (result.status === 'blocked') {
      return { exitCode, stdout: '', stderr: `blocked: ${result.issues.join('; ')}\n` }
    }
    return { exitCode, stdout: `${formatHuman(result)}\n`, stderr: '' }
  } catch (error) {
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: '',
        stderr: `${error.message}\n${error.exitCode === 64 ? `${usageText()}\n` : ''}`,
      }
    }
    return {
      exitCode: 3,
      stdout: '',
      stderr: `blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

function main() {
  const { exitCode, stdout, stderr } = runCli()
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  process.exit(exitCode)
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  } catch (_) {
    return false
  }
})()

if (isDirectRun) {
  main()
}
