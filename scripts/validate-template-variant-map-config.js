#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const ENV_VAR = 'GATEWAY_TEMPLATE_VARIANT_MAP'
const DEFAULT_ALLOWED_VARIANTS = ['signal', 'bastion', 'horizon']
const ARWEAVE_TXID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const TXID_PLACEHOLDER_PATTERN = /^REPLACE_WITH_[A-Z0-9_]+$/
const ENTRY_FIELDS = new Set(['variant', 'templateTxId', 'manifestTxId'])

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
    '  node scripts/validate-template-variant-map-config.js [--file <path>] [--require-sites <csv>] [--json] [--strict] [--allow-placeholders] [--help]',
    '',
    'Input:',
    `  --file <PATH>   Validate map JSON from file; when omitted, ${ENV_VAR} is used`,
    `  ${ENV_VAR}      JSON object map when --file is not provided`,
    '',
    'Options:',
    '  --require-sites <CSV>  Comma-separated required site keys',
    '  --allow-placeholders   Allow REPLACE_WITH_* txid placeholders',
    '  --json                 Print structured JSON only',
    '  --strict               Fail on missing required sites and malformed entries',
    '  --help                 Show this help',
    '',
    'Exit codes:',
    '  0   validation passed, or non-blocking findings without --strict',
    '  3   validation blocked, strict-mode failures, or runtime errors',
    '  64  usage error',
  ].join('\n')
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseCsv(value, flagName) {
  if (!isNonEmptyString(value)) {
    throw new CliError(`${flagName} must not be blank`, 64)
  }

  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (values.length === 0) {
    throw new CliError(`${flagName} must contain at least one site key`, 64)
  }

  return [...new Set(values)]
}

function parseArgs(argv) {
  const args = {
    file: '',
    strict: false,
    json: false,
    help: false,
    requireSites: [],
    allowPlaceholders: false,
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
    if (arg === '--allow-placeholders') {
      args.allowPlaceholders = true
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

    if (arg === '--file' || arg.startsWith('--file=')) {
      const value = arg === '--file' ? readValue() : arg.slice('--file='.length)
      if (!isNonEmptyString(value)) {
        throw new CliError('missing value for --file', 64)
      }
      args.file = value
      continue
    }

    if (arg === '--require-sites' || arg.startsWith('--require-sites=')) {
      const value = arg === '--require-sites' ? readValue() : arg.slice('--require-sites='.length)
      args.requireSites = parseCsv(value, '--require-sites')
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function parseMap(rawValue, label = ENV_VAR) {
  if (!isNonEmptyString(rawValue)) {
    return {
      ok: false,
      issues: [`${label} is not set`],
      map: null,
    }
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

function isPlaceholderValue(value) {
  return TXID_PLACEHOLDER_PATTERN.test(value)
}

function appendFinding(findings, code, message) {
  findings.push({ code, message })
}

function validateTemplateVariantMapConfig(variantMap, options = {}) {
  const strict = options.strict === true
  const allowPlaceholders = options.allowPlaceholders === true
  const requireSites = Array.isArray(options.requireSites) ? [...new Set(options.requireSites)] : []
  const allowedVariants = Array.isArray(options.allowedVariants) && options.allowedVariants.length > 0
    ? [...new Set(options.allowedVariants)]
    : [...DEFAULT_ALLOWED_VARIANTS]
  const findings = []
  const normalizedMap = {}

  let malformedEntryCount = 0
  let invalidTxIdCount = 0
  let placeholderCount = 0

  if (!isObject(variantMap)) {
    appendFinding(findings, 'malformed-entry', 'variant map must be a JSON object')
  } else {
    for (const [siteId, entry] of Object.entries(variantMap)) {
      const siteKey = normalizeString(siteId)
      if (!siteKey || siteKey !== siteId) {
        malformedEntryCount += 1
        appendFinding(findings, 'malformed-entry', `entry key "${siteId}" must be a non-empty trimmed string`)
        continue
      }

      const entryFindingStart = findings.length
      if (!isObject(entry)) {
        malformedEntryCount += 1
        appendFinding(findings, 'malformed-entry', `entry ${siteId} must be an object`)
        continue
      }

      const unknownFields = Object.keys(entry).filter((field) => !ENTRY_FIELDS.has(field))
      if (unknownFields.length > 0) {
        malformedEntryCount += 1
        appendFinding(findings, 'malformed-entry', `entry ${siteId} has unsupported fields: ${unknownFields.join(', ')}`)
      }

      const variant = normalizeString(entry.variant)
      if (!variant) {
        malformedEntryCount += 1
        appendFinding(findings, 'malformed-entry', `entry ${siteId}.variant must be a non-empty string`)
      } else if (!allowedVariants.includes(variant)) {
        malformedEntryCount += 1
        appendFinding(findings, 'malformed-entry', `entry ${siteId}.variant must be one of: ${allowedVariants.join(', ')}`)
      }

      const validateTxIdField = (fieldName) => {
        const value = normalizeString(entry[fieldName])
        if (!value) {
          malformedEntryCount += 1
          appendFinding(findings, 'malformed-entry', `entry ${siteId}.${fieldName} must be a non-empty string`)
          return { valid: false, value: '' }
        }

        if (isPlaceholderValue(value)) {
          placeholderCount += 1
          if (!allowPlaceholders) {
            appendFinding(
              findings,
              'placeholder-disallowed',
              `entry ${siteId}.${fieldName} contains placeholder value ${value}; pass --allow-placeholders to permit this`,
            )
            return { valid: false, value }
          }
          return { valid: true, value }
        }

        if (!ARWEAVE_TXID_PATTERN.test(value)) {
          invalidTxIdCount += 1
          appendFinding(
            findings,
            'invalid-txid',
            `entry ${siteId}.${fieldName} must be an Arweave txid-like value (43 base64url chars)`,
          )
          return { valid: false, value }
        }

        return { valid: true, value }
      }

      const templateTx = validateTxIdField('templateTxId')
      const manifestTx = validateTxIdField('manifestTxId')

      if (findings.length === entryFindingStart) {
        normalizedMap[siteId] = {
          variant,
          templateTxId: templateTx.value,
          manifestTxId: manifestTx.value,
        }
      }
    }
  }

  const providedSites = Object.keys(normalizedMap)
  const missingSites = requireSites.filter((siteId) => !providedSites.includes(siteId))

  if (missingSites.length > 0) {
    appendFinding(findings, 'missing-required-site', `missing required sites: ${missingSites.join(', ')}`)
  }

  const alwaysBlockingCodes = new Set(['placeholder-disallowed'])
  const blockingFindings = findings.filter((finding) => strict || alwaysBlockingCodes.has(finding.code))
  const warningFindings = findings.filter((finding) => !strict && !alwaysBlockingCodes.has(finding.code))

  let status = 'complete'
  if (blockingFindings.length > 0) {
    status = 'blocked'
  } else if (warningFindings.length > 0) {
    status = 'pending'
  }

  return {
    ok: status === 'complete',
    status,
    strict,
    allowPlaceholders,
    envVar: ENV_VAR,
    allowedVariants,
    requiredSites: requireSites,
    providedSites,
    missingSites,
    counts: {
      providedCount: providedSites.length,
      requiredCount: requireSites.length,
      missingCount: missingSites.length,
      malformedEntryCount,
      invalidTxIdCount,
      placeholderCount,
      issueCount: blockingFindings.length,
      warningCount: warningFindings.length,
      findingCount: findings.length,
    },
    issues: blockingFindings.map((finding) => finding.message),
    warnings: warningFindings.map((finding) => finding.message),
    map: normalizedMap,
  }
}

function formatHuman(result) {
  const sourceLabel = result.source.type === 'file' ? `file:${result.source.label}` : `env:${result.source.label}`
  const lines = [
    `Status: \`${result.status}\``,
    `Source: ${sourceLabel}`,
    `Strict: ${result.strict ? 'yes' : 'no'}`,
    `Allow placeholders: ${result.allowPlaceholders ? 'yes' : 'no'}`,
    `Allowed variants: ${result.allowedVariants.join(', ')}`,
    `Provided sites: ${result.counts.providedCount}`,
    `Required sites: ${result.counts.requiredCount}`,
    `Missing sites: ${result.missingSites.length > 0 ? result.missingSites.join(', ') : 'none'}`,
    `Malformed entries: ${result.counts.malformedEntryCount}`,
    `Invalid txids: ${result.counts.invalidTxIdCount}`,
    `Placeholder values: ${result.counts.placeholderCount}`,
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

  return `${lines.join('\n')}\n`
}

async function readSource(args, env = process.env) {
  if (isNonEmptyString(args.file)) {
    let raw
    try {
      raw = await readFile(args.file, 'utf8')
    } catch (error) {
      return {
        fatal: true,
        issues: [`unable to read map file ${args.file}: ${error instanceof Error ? error.message : String(error)}`],
        source: { type: 'file', label: args.file },
      }
    }

    const parsed = parseMap(raw, `file ${args.file}`)
    if (!parsed.ok) {
      return {
        fatal: true,
        issues: parsed.issues,
        source: { type: 'file', label: args.file },
      }
    }

    return {
      fatal: false,
      ok: true,
      map: parsed.map,
      source: { type: 'file', label: args.file },
    }
  }

  const parsed = parseMap(env[ENV_VAR], ENV_VAR)
  return {
    fatal: false,
    ok: parsed.ok,
    issues: parsed.issues,
    map: parsed.map,
    source: { type: 'env', label: ENV_VAR },
  }
}

function buildSourceIssueResult(args, source, issues, forceBlocked = false) {
  const blocking = forceBlocked || args.strict ? [...issues] : []
  const warnings = forceBlocked || args.strict ? [] : [...issues]

  return {
    ok: false,
    status: blocking.length > 0 ? 'blocked' : 'pending',
    strict: args.strict,
    allowPlaceholders: args.allowPlaceholders,
    envVar: ENV_VAR,
    source,
    allowedVariants: [...DEFAULT_ALLOWED_VARIANTS],
    requiredSites: args.requireSites,
    providedSites: [],
    missingSites: [...args.requireSites],
    counts: {
      providedCount: 0,
      requiredCount: args.requireSites.length,
      missingCount: args.requireSites.length,
      malformedEntryCount: 0,
      invalidTxIdCount: 0,
      placeholderCount: 0,
      issueCount: blocking.length,
      warningCount: warnings.length,
      findingCount: issues.length,
    },
    issues: blocking,
    warnings,
    map: null,
  }
}

async function runCli(argv = process.argv.slice(2), env = process.env) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
    }

    const sourceResult = await readSource(args, env)
    if (sourceResult.fatal) {
      const result = buildSourceIssueResult(args, sourceResult.source, sourceResult.issues, true)
      return args.json
        ? { exitCode: 3, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' }
        : { exitCode: 3, stdout: '', stderr: `blocked: ${sourceResult.issues.join('; ')}\n` }
    }

    if (!sourceResult.ok) {
      const result = buildSourceIssueResult(args, sourceResult.source, sourceResult.issues)
      const exitCode = result.status === 'blocked' ? 3 : 0
      return args.json
        ? { exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' }
        : { exitCode, stdout: formatHuman(result), stderr: '' }
    }

    const validated = validateTemplateVariantMapConfig(sourceResult.map, {
      strict: args.strict,
      allowPlaceholders: args.allowPlaceholders,
      requireSites: args.requireSites,
      allowedVariants: DEFAULT_ALLOWED_VARIANTS,
    })
    const result = {
      ...validated,
      source: sourceResult.source,
    }
    const exitCode = result.status === 'blocked' ? 3 : 0

    return args.json
      ? { exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' }
      : { exitCode, stdout: formatHuman(result), stderr: '' }
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
      stderr: `blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

async function main() {
  const result = await runCli(process.argv.slice(2), process.env)
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
  CliError,
  ARWEAVE_TXID_PATTERN,
  DEFAULT_ALLOWED_VARIANTS,
  ENV_VAR,
  TXID_PLACEHOLDER_PATTERN,
  formatHuman,
  parseArgs,
  parseCsv,
  parseMap,
  readSource,
  runCli,
  usageText,
  validateTemplateVariantMapConfig,
}
