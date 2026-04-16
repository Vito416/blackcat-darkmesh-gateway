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

export const ENV_VAR = 'GATEWAY_TEMPLATE_VARIANT_MAP'

function usageText() {
  return [
    'Usage:',
    '  node scripts/build-template-variant-fallback-map.js --fallback-variant <NAME> [--file <PATH>] [--template-txid <TXID>] [--manifest-txid <TXID>] [--sites <csv>] [--json] [--help]',
    '',
    'Input:',
    `  --file <PATH> or ${ENV_VAR} (JSON object map)`,
    '',
    'Options:',
    '  --fallback-variant <NAME>  Variant applied to selected sites (required)',
    '  --template-txid <TXID>     Optional templateTxId override for selected sites',
    '  --manifest-txid <TXID>     Optional manifestTxId override for selected sites',
    '  --sites <CSV>              Optional subset of site keys to update (default: all sites)',
    '  --json                     Print structured JSON output',
    '  --help                     Show this help',
    '',
    'Exit codes:',
    '  0   success',
    '  3   invalid map data or runtime failure',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseCsvSites(raw) {
  if (!isNonEmptyString(raw)) {
    throw new CliError('--sites must not be blank', 64)
  }

  const seen = new Set()
  const sites = []
  for (const value of raw.split(',')) {
    const site = value.trim()
    if (!site) continue
    if (!seen.has(site)) {
      seen.add(site)
      sites.push(site)
    }
  }

  if (sites.length === 0) {
    throw new CliError('--sites must contain at least one site key', 64)
  }
  return sites
}

function readOptionValue(arg, flagName, readValue) {
  const value = arg === flagName ? readValue() : arg.slice(`${flagName}=`.length)
  if (!isNonEmptyString(value)) {
    throw new CliError(`missing value for ${flagName}`, 64)
  }
  return value.trim()
}

export function parseArgs(argv) {
  const args = {
    file: '',
    fallbackVariant: '',
    templateTxId: undefined,
    manifestTxId: undefined,
    sites: [],
    json: false,
    help: false,
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

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    if (arg === '--file' || arg.startsWith('--file=')) {
      args.file = readOptionValue(arg, '--file', readValue)
      continue
    }

    if (arg === '--fallback-variant' || arg.startsWith('--fallback-variant=')) {
      args.fallbackVariant = readOptionValue(arg, '--fallback-variant', readValue)
      continue
    }

    if (arg === '--template-txid' || arg.startsWith('--template-txid=')) {
      args.templateTxId = readOptionValue(arg, '--template-txid', readValue)
      continue
    }

    if (arg === '--manifest-txid' || arg.startsWith('--manifest-txid=')) {
      args.manifestTxId = readOptionValue(arg, '--manifest-txid', readValue)
      continue
    }

    if (arg === '--sites' || arg.startsWith('--sites=')) {
      const rawSites = readOptionValue(arg, '--sites', readValue)
      args.sites = parseCsvSites(rawSites)
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  if (!isNonEmptyString(args.fallbackVariant)) {
    throw new CliError('--fallback-variant is required', 64)
  }

  return args
}

function resolveMapSource(args, env, fsApi = { readFileSync }) {
  if (isNonEmptyString(args.file)) {
    try {
      return {
        rawMap: fsApi.readFileSync(args.file, 'utf8'),
        source: `--file ${args.file}`,
      }
    } catch (error) {
      throw new CliError(
        `unable to read ${args.file}: ${error instanceof Error ? error.message : String(error)}`,
        3,
      )
    }
  }

  if (!isNonEmptyString(env[ENV_VAR])) {
    throw new CliError(`missing input map: use --file or set ${ENV_VAR}`, 64)
  }

  return {
    rawMap: env[ENV_VAR],
    source: ENV_VAR,
  }
}

function parseMap(rawMap, source) {
  let parsed
  try {
    parsed = JSON.parse(rawMap)
  } catch (error) {
    throw new CliError(
      `${source} must be valid JSON (${error instanceof Error ? error.message : String(error)})`,
      3,
    )
  }

  if (!isObject(parsed)) {
    throw new CliError(`${source} must be a JSON object`, 3)
  }

  return parsed
}

function resolveSelectedSites(variantMap, sites) {
  if (sites.length === 0) {
    return Object.keys(variantMap)
  }

  const missing = sites.filter((site) => !Object.prototype.hasOwnProperty.call(variantMap, site))
  if (missing.length > 0) {
    throw new CliError(`unknown site(s) in --sites: ${missing.join(', ')}`, 64)
  }

  return sites
}

export function buildTemplateVariantFallbackMap({
  variantMap,
  fallbackVariant,
  templateTxId,
  manifestTxId,
  sites = [],
}) {
  if (!isObject(variantMap)) {
    throw new CliError('variant map must be a JSON object', 3)
  }
  if (!isNonEmptyString(fallbackVariant)) {
    throw new CliError('--fallback-variant is required', 64)
  }

  const selectedSites = resolveSelectedSites(variantMap, sites)
  const rebuiltMap = { ...variantMap }

  for (const site of selectedSites) {
    const current = isObject(variantMap[site]) ? { ...variantMap[site] } : {}
    current.variant = fallbackVariant
    if (typeof templateTxId !== 'undefined') {
      current.templateTxId = templateTxId
    }
    if (typeof manifestTxId !== 'undefined') {
      current.manifestTxId = manifestTxId
    }
    rebuiltMap[site] = current
  }

  return {
    map: rebuiltMap,
    selectedSites,
  }
}

export function runCli(argv = process.argv.slice(2), env = process.env, fsApi = { readFileSync }) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: usageText(), stderr: '' }
    }

    const sourceMap = resolveMapSource(args, env, fsApi)
    const parsedMap = parseMap(sourceMap.rawMap, sourceMap.source)
    const rebuilt = buildTemplateVariantFallbackMap({
      variantMap: parsedMap,
      fallbackVariant: args.fallbackVariant,
      templateTxId: args.templateTxId,
      manifestTxId: args.manifestTxId,
      sites: args.sites,
    })

    if (args.json) {
      const payload = {
        envVar: ENV_VAR,
        source: sourceMap.source,
        fallbackVariant: args.fallbackVariant,
        templateTxId: typeof args.templateTxId === 'undefined' ? null : args.templateTxId,
        manifestTxId: typeof args.manifestTxId === 'undefined' ? null : args.manifestTxId,
        selectedSites: rebuilt.selectedSites,
        map: rebuilt.map,
      }
      return { exitCode: 0, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: '' }
    }

    return {
      exitCode: 0,
      stdout: `${JSON.stringify(rebuilt.map, null, 2)}\n`,
      stderr: '',
    }
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
      stderr: `error: ${error instanceof Error ? error.message : String(error)}\n`,
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
