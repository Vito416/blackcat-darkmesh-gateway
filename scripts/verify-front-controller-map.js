#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ENV_VAR = 'GATEWAY_FRONT_CONTROLLER_TEMPLATE_MAP'
const TX_ID_RE = /^[A-Za-z0-9_-]{8,128}$/
const SHA256_HEX_RE = /^[a-f0-9]{64}$/
const DEFAULT_TIMEOUT_MS = 10_000

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
    '  node scripts/verify-front-controller-map.js [--strict] [--require-wildcard] [--skip-fetch] [--map-file <path>] [--map-json <json>] [--ar-gateway-base <url>] [--timeout-ms <ms>] [--json]',
    '',
    'Environment:',
    `  ${ENV_VAR}  JSON object mapping host -> {templateTxId, templateSha256}`,
    '',
    'Modes:',
    '  default     pending on missing map source (exit 0)',
    '  --strict    blocked on missing/invalid map source (exit 3)',
    '',
    'Exit codes:',
    '  0   verification passed (or pending without --strict)',
    '  3   blocked / malformed / verification mismatch',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+$/, '')
}

function parseTxId(value) {
  if (!isNonEmptyString(value)) return null
  const txId = value.trim()
  return TX_ID_RE.test(txId) ? txId : null
}

function parseSha256(value) {
  if (!isNonEmptyString(value)) return null
  let normalized = value.trim().toLowerCase()
  if (normalized.startsWith('sha256-')) normalized = normalized.slice(7)
  if (normalized.startsWith('0x')) normalized = normalized.slice(2)
  return SHA256_HEX_RE.test(normalized) ? normalized : null
}

function parseArgs(argv) {
  const args = {
    strict: false,
    json: false,
    help: false,
    requireWildcard: false,
    skipFetch: false,
    mapFile: null,
    mapJson: null,
    arGatewayBase: 'https://arweave.net',
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      i += 1
      return next
    }

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
    if (arg === '--require-wildcard') {
      args.requireWildcard = true
      continue
    }
    if (arg === '--skip-fetch') {
      args.skipFetch = true
      continue
    }
    if (arg === '--map-file' || arg.startsWith('--map-file=')) {
      args.mapFile = arg === '--map-file' ? readValue() : arg.slice('--map-file='.length)
      continue
    }
    if (arg === '--map-json' || arg.startsWith('--map-json=')) {
      args.mapJson = arg === '--map-json' ? readValue() : arg.slice('--map-json='.length)
      continue
    }
    if (arg === '--ar-gateway-base' || arg.startsWith('--ar-gateway-base=')) {
      const value = arg === '--ar-gateway-base' ? readValue() : arg.slice('--ar-gateway-base='.length)
      if (!isNonEmptyString(value)) throw new CliError('--ar-gateway-base must not be blank', 64)
      args.arGatewayBase = value.trim().replace(/\/+$/, '')
      continue
    }
    if (arg === '--timeout-ms' || arg.startsWith('--timeout-ms=')) {
      const value = arg === '--timeout-ms' ? readValue() : arg.slice('--timeout-ms='.length)
      const timeout = Number.parseInt(value, 10)
      if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new CliError('--timeout-ms must be a positive integer', 64)
      }
      args.timeoutMs = timeout
      continue
    }

    if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  if (args.mapFile && args.mapJson) {
    throw new CliError('--map-file and --map-json are mutually exclusive', 64)
  }

  return args
}

function resolveMapRaw({ args, env }) {
  if (isNonEmptyString(args.mapJson)) return args.mapJson
  if (isNonEmptyString(args.mapFile)) {
    if (!fs.existsSync(args.mapFile)) {
      throw new CliError(`map file not found: ${args.mapFile}`, 64)
    }
    return fs.readFileSync(args.mapFile, 'utf8')
  }
  const envRaw = env[ENV_VAR]
  if (isNonEmptyString(envRaw)) return envRaw
  return null
}

export function parseTemplateMap(rawMap) {
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

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [`${ENV_VAR} must be a JSON object`],
      map: null,
    }
  }

  const issues = []
  const map = {}
  for (const [hostKey, entryRaw] of Object.entries(parsed)) {
    const host = normalizeHost(hostKey)
    if (!host) {
      issues.push('host keys must be non-empty strings')
      continue
    }

    const entry = entryRaw && typeof entryRaw === 'object' ? entryRaw : null
    const txId = parseTxId(entryRaw) || parseTxId(entry?.templateTxId) || parseTxId(entry?.txId)
    if (!txId) {
      issues.push(`entry ${host} is missing valid templateTxId`)
      continue
    }

    const templateSha256 = parseSha256(entry?.templateSha256) || parseSha256(entry?.sha256) || parseSha256(entry?.hash)
    if (!templateSha256) {
      issues.push(`entry ${host} is missing valid templateSha256`)
      continue
    }

    map[host] = {
      templateTxId: txId,
      templateSha256,
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    map,
  }
}

async function fetchTextWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function verifyTemplateMap({
  templateMap,
  strict = false,
  requireWildcard = false,
  skipFetch = false,
  arGatewayBase = 'https://arweave.net',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
}) {
  const issues = []
  const warnings = []

  if (!templateMap || typeof templateMap !== 'object' || Array.isArray(templateMap)) {
    return {
      ok: false,
      status: 'blocked',
      strict,
      issues: ['template map must be an object'],
      warnings,
      entries: {},
      checkedTxCount: 0,
      requireWildcard,
      skipFetch,
    }
  }

  const hosts = Object.keys(templateMap)
  if (hosts.length === 0) {
    issues.push('template map is empty')
  }
  if (requireWildcard && !Object.prototype.hasOwnProperty.call(templateMap, '*')) {
    issues.push('template map is missing wildcard (*) fallback entry')
  }

  const txChecks = new Map()
  const entries = {}

  for (const host of hosts) {
    const entry = templateMap[host]
    const txId = parseTxId(entry?.templateTxId)
    const expectedSha = parseSha256(entry?.templateSha256)
    if (!txId || !expectedSha) {
      issues.push(`entry ${host} is invalid (templateTxId/templateSha256)`) 
      continue
    }

    entries[host] = {
      templateTxId: txId,
      expectedSha256: expectedSha,
      verified: skipFetch,
    }

    if (!skipFetch && !txChecks.has(txId)) {
      txChecks.set(txId, expectedSha)
    }
  }

  if (!skipFetch && typeof fetchImpl !== 'function') {
    issues.push('fetch implementation is not available')
  }

  if (!skipFetch && issues.length === 0) {
    for (const [txId, expectedSha] of txChecks.entries()) {
      const url = `${arGatewayBase}/${txId}`
      let response
      try {
        response = await fetchTextWithTimeout(fetchImpl, url, timeoutMs)
      } catch (error) {
        issues.push(`fetch failed for ${txId} (${error instanceof Error ? error.message : String(error)})`)
        continue
      }

      if (!response.ok) {
        issues.push(`fetch returned ${response.status} for ${txId}`)
        continue
      }

      const body = await response.text()
      const actualSha = createHash('sha256').update(body).digest('hex')
      if (actualSha !== expectedSha) {
        issues.push(`sha256 mismatch for ${txId} (expected ${expectedSha}, got ${actualSha})`)
        continue
      }

      for (const host of hosts) {
        const item = entries[host]
        if (item?.templateTxId === txId) {
          item.verified = true
          item.actualSha256 = actualSha
        }
      }
    }
  }

  let status = 'complete'
  if (issues.length > 0) status = 'blocked'

  return {
    ok: status === 'complete',
    status,
    strict,
    requireWildcard,
    skipFetch,
    checkedTxCount: txChecks.size,
    issues,
    warnings,
    entries,
  }
}

function formatHuman(result) {
  const lines = [
    `Status: ${result.status}`,
    `Entries: ${Object.keys(result.entries || {}).length}`,
    `Checked tx: ${result.checkedTxCount}`,
    `Wildcard required: ${result.requireWildcard ? 'yes' : 'no'}`,
    `Fetch mode: ${result.skipFetch ? 'skip' : 'verify'}`,
  ]

  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:')
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }

  if (result.issues.length > 0) {
    lines.push('', 'Issues:')
    for (const issue of result.issues) lines.push(`- ${issue}`)
  }

  return lines.join('\n')
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const env = options.env ?? process.env
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`${error.message}\n\n${usageText()}\n`)
      return { exitCode: error.exitCode, stdout: '', stderr: `${error.message}\n` }
    }
    throw error
  }

  if (args.help) {
    const text = `${usageText()}\n`
    stdout.write(text)
    return { exitCode: 0, stdout: text, stderr: '' }
  }

  let rawMap
  try {
    rawMap = resolveMapRaw({ args, env })
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`${error.message}\n`)
      return { exitCode: error.exitCode, stdout: '', stderr: `${error.message}\n` }
    }
    throw error
  }

  if (!isNonEmptyString(rawMap)) {
    const result = {
      ok: false,
      status: args.strict ? 'blocked' : 'pending',
      strict: args.strict,
      requireWildcard: args.requireWildcard,
      skipFetch: args.skipFetch,
      checkedTxCount: 0,
      issues: args.strict ? [`${ENV_VAR} is not set`] : [],
      warnings: args.strict ? [] : [`${ENV_VAR} is not set`],
      entries: {},
    }
    const payload = args.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHuman(result)}\n`
    stdout.write(payload)
    return { exitCode: args.strict ? 3 : 0, stdout: payload, stderr: '' }
  }

  const parsed = parseTemplateMap(rawMap)
  if (!parsed.ok || !parsed.map) {
    const result = {
      ok: false,
      status: 'blocked',
      strict: args.strict,
      requireWildcard: args.requireWildcard,
      skipFetch: args.skipFetch,
      checkedTxCount: 0,
      issues: parsed.issues,
      warnings: [],
      entries: {},
    }
    const payload = args.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHuman(result)}\n`
    stdout.write(payload)
    return { exitCode: 3, stdout: payload, stderr: '' }
  }

  const result = await verifyTemplateMap({
    templateMap: parsed.map,
    strict: args.strict,
    requireWildcard: args.requireWildcard,
    skipFetch: args.skipFetch,
    arGatewayBase: args.arGatewayBase,
    timeoutMs: args.timeoutMs,
    fetchImpl,
  })

  const payload = args.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHuman(result)}\n`
  stdout.write(payload)
  return { exitCode: result.ok ? 0 : 3, stdout: payload, stderr: '' }
}

const isMain = (() => {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(process.argv[1]).href
})()

if (isMain) {
  runCli().then(({ exitCode }) => {
    process.exit(exitCode)
  })
}
