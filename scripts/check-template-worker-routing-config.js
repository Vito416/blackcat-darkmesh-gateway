#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

function usage(exitCode = 0) {
  console.log([
    'Usage:',
    '  node scripts/check-template-worker-routing-config.js --url-map <json> [--token-map <json>] [--json] [--strict]',
    '',
    'Options:',
    '  --url-map <JSON>    Required JSON object of routing keys -> absolute http(s) URLs',
    '  --token-map <JSON>  Optional JSON object of routing keys -> non-empty token strings',
    '  --json              Emit machine-readable JSON output',
    '  --strict            Require full token coverage for every URL map key',
    '  --help              Show this help',
    '',
    'Exit codes:',
    '  0   complete or pending (non-strict)',
    '  3   blocked / malformed / strict failure',
    '  64  usage error',
  ].join('\n'))
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseJsonArg(value, label) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${label} must be a JSON string`)
  }

  try {
    return JSON.parse(value)
  } catch (err) {
    throw new Error(`${label} must be valid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
}

function isAbsoluteHttpUrl(value) {
  if (!isNonEmptyString(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (_) {
    return false
  }
}

function validateUrlMap(urlMap) {
  const issues = []
  const normalized = {}

  if (!isObject(urlMap)) {
    return {
      ok: false,
      issues: ['url map must be a JSON object'],
      normalized: null,
    }
  }

  for (const [key, value] of Object.entries(urlMap)) {
    if (!isNonEmptyString(key)) {
      issues.push('url map keys must be non-empty strings')
      continue
    }
    if (!isAbsoluteHttpUrl(value)) {
      issues.push(`url map entry ${key} must be an absolute http(s) URL`)
      continue
    }
    normalized[key] = value
  }

  return {
    ok: issues.length === 0,
    issues,
    normalized,
  }
}

function validateTokenMap(tokenMap, urlMapKeys) {
  const issues = []
  const normalized = {}

  if (typeof tokenMap === 'undefined') {
    return { ok: true, issues, normalized: null }
  }

  if (!isObject(tokenMap)) {
    return {
      ok: false,
      issues: ['token map must be a JSON object when provided'],
      normalized: null,
    }
  }

  for (const [key, value] of Object.entries(tokenMap)) {
    if (!isNonEmptyString(key)) {
      issues.push('token map keys must be non-empty strings')
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(urlMapKeys, key)) {
      issues.push(`token map key ${key} does not exist in url map`)
      continue
    }
    if (!isNonEmptyString(value)) {
      issues.push(`token map entry ${key} must be a non-empty string`)
      continue
    }
    normalized[key] = value
  }

  return {
    ok: issues.length === 0,
    issues,
    normalized,
  }
}

function assessTemplateWorkerRoutingConfig({ urlMap, tokenMap, strict }) {
  const urlResult = validateUrlMap(urlMap)
  if (!urlResult.ok) {
    return {
      status: 'blocked',
      issues: urlResult.issues,
      warnings: [],
      counts: {
        urlMapCount: isObject(urlMap) ? Object.keys(urlMap).length : 0,
        tokenMapCount: isObject(tokenMap) ? Object.keys(tokenMap).length : 0,
        coveredCount: 0,
        missingTokenCount: 0,
        extraTokenCount: 0,
      },
    }
  }

  const tokenResult = validateTokenMap(tokenMap, urlResult.normalized || {})
  if (!tokenResult.ok) {
    return {
      status: 'blocked',
      issues: tokenResult.issues,
      warnings: [],
      counts: {
        urlMapCount: Object.keys(urlResult.normalized || {}).length,
        tokenMapCount: isObject(tokenMap) ? Object.keys(tokenMap).length : 0,
        coveredCount: 0,
        missingTokenCount: 0,
        extraTokenCount: 0,
      },
    }
  }

  const urlKeys = Object.keys(urlResult.normalized || {})
  const tokenKeys = tokenResult.normalized ? Object.keys(tokenResult.normalized) : []
  const missingTokenKeys = urlKeys.filter((key) => !tokenKeys.includes(key))
  const coveredCount = urlKeys.length - missingTokenKeys.length

  const warnings = []
  const issues = []
  let status = 'complete'

  if (!tokenResult.normalized) {
    status = 'pending'
    warnings.push('token map not provided; routing is complete but token coverage is pending')
  } else if (missingTokenKeys.length > 0) {
    if (strict) {
      status = 'blocked'
      issues.push(`missing token coverage for: ${missingTokenKeys.join(', ')}`)
    } else {
      status = 'pending'
      warnings.push(`missing token coverage for: ${missingTokenKeys.join(', ')}`)
    }
  }

  return {
    status,
    issues,
    warnings,
    counts: {
      urlMapCount: urlKeys.length,
      tokenMapCount: tokenKeys.length,
      coveredCount,
      missingTokenCount: missingTokenKeys.length,
      extraTokenCount: 0,
    },
  }
}

function formatHuman(result) {
  const lines = [
    `status: ${result.status}`,
    `counts: urlMap=${result.counts.urlMapCount} tokenMap=${result.counts.tokenMapCount} covered=${result.counts.coveredCount} missingTokens=${result.counts.missingTokenCount} extraTokens=${result.counts.extraTokenCount}`,
  ]

  if (result.issues.length > 0) {
    lines.push(`issues: ${result.issues.join(' | ')}`)
  }
  if (result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(' | ')}`)
  }

  return lines.join('\n')
}

async function main() {
  const argv = process.argv.slice(2)
  let urlMapRaw = null
  let tokenMapRaw = undefined
  let jsonMode = false
  let strict = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--json') {
      jsonMode = true
      continue
    }
    if (arg === '--strict') {
      strict = true
      continue
    }
    if (arg === '--url-map') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --url-map')
      urlMapRaw = next
      i += 1
      continue
    }
    if (arg === '--token-map') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --token-map')
      tokenMapRaw = next
      i += 1
      continue
    }
    if (arg.startsWith('--')) die(`unknown option: ${arg}`)
    die(`unexpected positional argument: ${arg}`)
  }

  if (!isNonEmptyString(urlMapRaw)) {
    die('--url-map is required')
  }

  let urlMap
  let tokenMap

  try {
    urlMap = parseJsonArg(urlMapRaw, '--url-map')
    if (typeof tokenMapRaw !== 'undefined') {
      tokenMap = parseJsonArg(tokenMapRaw, '--token-map')
    }
  } catch (err) {
    console.error(`blocked: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(3)
  }

  const result = assessTemplateWorkerRoutingConfig({ urlMap, tokenMap, strict })

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatHuman(result))
  }

  if (result.status === 'blocked') {
    process.exit(3)
  }
  process.exit(0)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    die(err instanceof Error ? err.message : String(err))
  })
}

export {
  assessTemplateWorkerRoutingConfig,
  formatHuman,
  isAbsoluteHttpUrl,
  isNonEmptyString,
  isObject,
  parseJsonArg,
  validateTokenMap,
  validateUrlMap,
}
