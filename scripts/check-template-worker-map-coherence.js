#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

const ENV_VARS = {
  urlMap: 'GATEWAY_TEMPLATE_WORKER_URL_MAP',
  tokenMap: 'GATEWAY_TEMPLATE_WORKER_TOKEN_MAP',
  signatureRefMap: 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP',
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-template-worker-map-coherence.js [--require-sites <csv>] [--require-token-map] [--require-signature-map] [--json] [--strict] [--help]',
    '',
    'Environment:',
    `  ${ENV_VARS.urlMap}          JSON object mapping site keys to absolute http(s) worker URLs`,
    `  ${ENV_VARS.tokenMap}        Optional JSON object mapping site keys to worker tokens`,
    `  ${ENV_VARS.signatureRefMap} Optional JSON object mapping site keys to worker signature refs`,
    '',
    'Options:',
    '  --require-sites <CSV>      Comma-separated list of required site keys',
    '  --require-token-map        Treat missing token coverage as a blocker',
    '  --require-signature-map    Treat missing signature-ref coverage as a blocker',
    '  --json                     Print structured JSON only',
    '  --strict                   Fail when the URL map is empty or any warning remains',
    '  --help                     Show this help',
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

function parseRequireSites(value) {
  if (!isNonEmptyString(value)) {
    throw new CliError('--require-sites must not be blank', 64)
  }

  const seen = new Set()
  const sites = []
  for (const rawSite of value.split(',')) {
    const site = rawSite.trim()
    if (!site) {
      continue
    }
    if (!seen.has(site)) {
      seen.add(site)
      sites.push(site)
    }
  }

  if (sites.length === 0) {
    throw new CliError('--require-sites must contain at least one site key', 64)
  }

  return sites
}

function parseBooleanFlag(argv, flagName) {
  return argv.includes(flagName)
}

function parseCsvFlagValue(argv, flagName) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === flagName) {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${flagName}`, 64)
      }
      return next
    }
    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1)
    }
  }
  return null
}

function parseArgs(argv) {
  const args = {
    json: false,
    strict: false,
    help: false,
    requireTokenMap: false,
    requireSignatureMap: false,
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

    if (arg === '--require-token-map') {
      args.requireTokenMap = true
      continue
    }

    if (arg === '--require-signature-map') {
      args.requireSignatureMap = true
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

function parseJsonObjectMap(rawValue, label, { required = false } = {}) {
  if (!isNonEmptyString(rawValue)) {
    return {
      present: false,
      ok: !required,
      map: null,
      issues: required ? [`${label} is not set`] : [],
    }
  }

  let parsed
  try {
    parsed = JSON.parse(rawValue)
  } catch (error) {
    return {
      present: true,
      ok: false,
      map: null,
      issues: [`${label} must be valid JSON (${error instanceof Error ? error.message : String(error)})`],
    }
  }

  if (!isObject(parsed)) {
    return {
      present: true,
      ok: false,
      map: null,
      issues: [`${label} must be a JSON object`],
    }
  }

  const normalized = {}
  const issues = []

  for (const [key, value] of Object.entries(parsed)) {
    if (!isNonEmptyString(key)) {
      issues.push(`${label} keys must be non-empty strings`)
      continue
    }
    if (!isNonEmptyString(value)) {
      issues.push(`${label} entry ${key} must be a non-empty string`)
      continue
    }
    normalized[key] = value.trim()
  }

  return {
    present: true,
    ok: issues.length === 0,
    map: normalized,
    issues,
  }
}

function validateAbsoluteHttpUrl(value) {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (_) {
    return false
  }
}

function validateWorkerUrlMap(urlMap) {
  const normalized = {}
  const issues = []

  if (!isObject(urlMap)) {
    return {
      ok: false,
      issues: ['GATEWAY_TEMPLATE_WORKER_URL_MAP must be a JSON object'],
      map: null,
    }
  }

  for (const [key, value] of Object.entries(urlMap)) {
    if (!isNonEmptyString(key)) {
      issues.push('GATEWAY_TEMPLATE_WORKER_URL_MAP keys must be non-empty strings')
      continue
    }
    if (!validateAbsoluteHttpUrl(value)) {
      issues.push(`GATEWAY_TEMPLATE_WORKER_URL_MAP entry ${key} must be an absolute http(s) URL`)
      continue
    }
    normalized[key] = value.trim()
  }

  return {
    ok: issues.length === 0,
    issues,
    map: normalized,
  }
}

function validateStringMap(map, label) {
  const normalized = {}
  const issues = []

  if (!isObject(map)) {
    return {
      ok: false,
      issues: [`${label} must be a JSON object when provided`],
      map: null,
    }
  }

  for (const [key, value] of Object.entries(map)) {
    if (!isNonEmptyString(key)) {
      issues.push(`${label} keys must be non-empty strings`)
      continue
    }
    if (!isNonEmptyString(value)) {
      issues.push(`${label} entry ${key} must be a non-empty string`)
      continue
    }
    normalized[key] = value.trim()
  }

  return {
    ok: issues.length === 0,
    issues,
    map: normalized,
  }
}

function addMissingIssues({ missingKeys, label, strict, requireMap, warnings, issues }) {
  if (missingKeys.length === 0) {
    return
  }

  const message = `missing ${label} for: ${missingKeys.join(', ')}`
  if (strict || requireMap) {
    issues.push(message)
  } else {
    warnings.push(message)
  }
}

function assessTemplateWorkerMapCoherence({
  urlMap,
  tokenMap,
  signatureRefMap,
  strict = false,
  requireSites = [],
  requireTokenMap = false,
  requireSignatureMap = false,
}) {
  const urlResult = urlMap == null ? { ok: true, issues: [], map: null } : validateWorkerUrlMap(urlMap)
  const issues = [...urlResult.issues]
  const warnings = []

  if (!urlResult.ok) {
    return {
      ok: false,
      status: 'blocked',
      strict,
      envVars: { ...ENV_VARS },
      requiredSites: requireSites,
      maps: {
        url: urlResult.map,
        token: null,
        signatureRef: null,
      },
      counts: {
        urlMapCount: isObject(urlMap) ? Object.keys(urlMap).length : 0,
        tokenMapCount: isObject(tokenMap) ? Object.keys(tokenMap).length : 0,
        signatureRefMapCount: isObject(signatureRefMap) ? Object.keys(signatureRefMap).length : 0,
        requiredSiteCount: requireSites.length,
        missingRequiredSiteCount: requireSites.length,
        missingTokenCount: 0,
        missingSignatureRefCount: 0,
        extraTokenCount: 0,
        extraSignatureRefCount: 0,
      },
      issues,
      warnings,
    }
  }

  const urlKeys = Object.keys(urlResult.map || {})
  const missingRequiredSites = requireSites.filter((site) => !urlKeys.includes(site))
  if (urlMap == null) {
    if (strict) {
      issues.push(`${ENV_VARS.urlMap} is not set`)
    } else {
      warnings.push(`${ENV_VARS.urlMap} is not set`)
    }
  } else if (urlKeys.length === 0) {
    if (strict) {
      issues.push('GATEWAY_TEMPLATE_WORKER_URL_MAP must contain at least one site in strict mode')
    } else {
      warnings.push('GATEWAY_TEMPLATE_WORKER_URL_MAP is empty')
    }
  }
  if (missingRequiredSites.length > 0) {
    addMissingIssues({
      missingKeys: missingRequiredSites,
      label: 'required site entries from --require-sites',
      strict,
      requireMap: true,
      warnings,
      issues,
    })
  }

  const tokenResult = tokenMap == null
    ? { ok: true, issues: [], map: null }
    : validateStringMap(tokenMap, 'GATEWAY_TEMPLATE_WORKER_TOKEN_MAP')
  const signatureResult = signatureRefMap == null
    ? { ok: true, issues: [], map: null }
    : validateStringMap(signatureRefMap, 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP')

  if (!tokenResult.ok) {
    issues.push(...tokenResult.issues)
  }
  if (!signatureResult.ok) {
    issues.push(...signatureResult.issues)
  }

  const tokenKeys = tokenResult.map ? Object.keys(tokenResult.map) : []
  const signatureKeys = signatureResult.map ? Object.keys(signatureResult.map) : []

  const missingTokenKeys = urlKeys.filter((key) => !tokenKeys.includes(key))
  const missingSignatureKeys = urlKeys.filter((key) => !signatureKeys.includes(key))
  const extraTokenKeys = tokenKeys.filter((key) => !urlKeys.includes(key))
  const extraSignatureKeys = signatureKeys.filter((key) => !urlKeys.includes(key))

  addMissingIssues({
    missingKeys: missingTokenKeys,
    label: 'token map entries',
    strict,
    requireMap: requireTokenMap,
    warnings,
    issues,
  })
  addMissingIssues({
    missingKeys: missingSignatureKeys,
    label: 'signature-ref map entries',
    strict,
    requireMap: requireSignatureMap,
    warnings,
    issues,
  })

  if (extraTokenKeys.length > 0) {
    issues.push(`token map contains keys not present in URL map: ${extraTokenKeys.join(', ')}`)
  }
  if (extraSignatureKeys.length > 0) {
    issues.push(`signature-ref map contains keys not present in URL map: ${extraSignatureKeys.join(', ')}`)
  }

  const status = issues.length > 0 ? 'blocked' : warnings.length > 0 ? 'pending' : 'complete'

  return {
    ok: status === 'complete',
    status,
    strict,
    envVars: { ...ENV_VARS },
    requiredSites: requireSites,
    maps: {
      url: urlResult.map,
      token: tokenResult.map,
      signatureRef: signatureResult.map,
    },
    counts: {
      urlMapCount: urlKeys.length,
      tokenMapCount: tokenKeys.length,
      signatureRefMapCount: signatureKeys.length,
      requiredSiteCount: requireSites.length,
      missingRequiredSiteCount: missingRequiredSites.length,
      missingTokenCount: missingTokenKeys.length,
      missingSignatureRefCount: missingSignatureKeys.length,
      extraTokenCount: extraTokenKeys.length,
      extraSignatureRefCount: extraSignatureKeys.length,
    },
    issues,
    warnings,
  }
}

function formatHuman(result) {
  const lines = [
    `Status: \`${result.status}\``,
    `Env vars: ${result.envVars.urlMap}, ${result.envVars.tokenMap}, ${result.envVars.signatureRefMap}`,
    `URL maps: ${result.counts.urlMapCount}`,
    `Token maps: ${result.counts.tokenMapCount}`,
    `Signature-ref maps: ${result.counts.signatureRefMapCount}`,
    `Required sites: ${result.counts.requiredSiteCount}`,
    `Missing required sites: ${result.counts.missingRequiredSiteCount}`,
    `Missing token entries: ${result.counts.missingTokenCount}`,
    `Missing signature-ref entries: ${result.counts.missingSignatureRefCount}`,
    `Extra token entries: ${result.counts.extraTokenCount}`,
    `Extra signature-ref entries: ${result.counts.extraSignatureRefCount}`,
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

function runCli(argv = process.argv.slice(2), env = process.env) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: usageText(), stderr: '' }
    }

    const urlMap = parseJsonObjectMap(env[ENV_VARS.urlMap], ENV_VARS.urlMap)
    const tokenMap = parseJsonObjectMap(env[ENV_VARS.tokenMap], ENV_VARS.tokenMap)
    const signatureRefMap = parseJsonObjectMap(env[ENV_VARS.signatureRefMap], ENV_VARS.signatureRefMap)

    const issues = []
    if (!urlMap.ok) {
      issues.push(...urlMap.issues)
    }
    if (!tokenMap.ok) {
      issues.push(...tokenMap.issues)
    }
    if (!signatureRefMap.ok) {
      issues.push(...signatureRefMap.issues)
    }

    if (issues.length > 0) {
      const result = {
        ok: false,
        status: 'blocked',
        strict: args.strict,
        envVars: { ...ENV_VARS },
        requiredSites: args.requireSites,
        maps: {
          url: urlMap.map,
          token: tokenMap.map,
          signatureRef: signatureRefMap.map,
        },
        counts: {
          urlMapCount: urlMap.map ? Object.keys(urlMap.map).length : 0,
          tokenMapCount: tokenMap.map ? Object.keys(tokenMap.map).length : 0,
          signatureRefMapCount: signatureRefMap.map ? Object.keys(signatureRefMap.map).length : 0,
          requiredSiteCount: args.requireSites.length,
          missingRequiredSiteCount: 0,
          missingTokenCount: 0,
          missingSignatureRefCount: 0,
          extraTokenCount: 0,
          extraSignatureRefCount: 0,
        },
        issues,
        warnings: [],
      }

      return args.json
        ? {
            exitCode: 3,
            stdout: `${JSON.stringify(result, null, 2)}\n`,
            stderr: `blocked: ${issues.join('; ')}\n`,
          }
        : {
            exitCode: 3,
            stdout: `${formatHuman(result)}\n`,
            stderr: `blocked: ${issues.join('; ')}\n`,
          }
    }

    const result = assessTemplateWorkerMapCoherence({
      urlMap: urlMap.present ? urlMap.map : null,
      tokenMap: tokenMap.present ? tokenMap.map : null,
      signatureRefMap: signatureRefMap.present ? signatureRefMap.map : null,
      strict: args.strict,
      requireSites: args.requireSites,
      requireTokenMap: args.requireTokenMap,
      requireSignatureMap: args.requireSignatureMap,
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
  ENV_VARS,
  assessTemplateWorkerMapCoherence,
  formatHuman,
  isNonEmptyString,
  isObject,
  parseArgs,
  parseCsvFlagValue,
  parseJsonObjectMap,
  parseRequireSites,
  runCli,
  validateAbsoluteHttpUrl,
  validateStringMap,
  validateWorkerUrlMap,
}
