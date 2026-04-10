#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const PROFILES = {
  wedos_small: {
    headroom: 0.16,
    burstWeight: 0.32,
    blockedWeight: 18,
    bias: 2,
  },
  wedos_medium: {
    headroom: 0.24,
    burstWeight: 0.4,
    blockedWeight: 24,
    bias: 3,
  },
  diskless: {
    headroom: 0.14,
    burstWeight: 0.28,
    blockedWeight: 16,
    bias: 2,
  },
}

const VALID_PROFILES = new Set(Object.keys(PROFILES))

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/suggest-ratelimit-overrides.js --input <FILE> [--profile wedos_small|wedos_medium|diskless] [--floor <N>] [--ceiling <N>]',
      '',
      'Options:',
      '  --input <FILE>       JSON file with route stats array (required)',
      '  --profile <NAME>     wedos_small|wedos_medium|diskless (default: wedos_medium)',
      '  --floor <N>          Optional minimum suggested value',
      '  --ceiling <N>        Optional maximum suggested value',
      '  --help               Show this help',
      '',
      'Input format:',
      '  [',
      '    { "prefix": "inbox", "p95Rps": 12, "blockedRate": 0.1, "burstFactor": 1.4 },',
      '    { "prefix": "webhook", "p95Rps": 24, "blockedRate": 0.03, "burstFactor": 1.1 }',
      '  ]',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function parseInteger(value, flagName) {
  if (typeof value !== 'string' || !value.trim()) die(`${flagName} must not be blank`)
  if (!/^\d+$/.test(value.trim())) die(`${flagName} must be an integer`)
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) die(`${flagName} is invalid`)
  return parsed
}

function parseArgs(argv) {
  const args = {
    input: '',
    profile: 'wedos_medium',
    floor: undefined,
    ceiling: undefined,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`)
      i += 1
      return next
    }

    switch (arg) {
      case '--input':
        args.input = readValue()
        break
      case '--profile':
        args.profile = readValue()
        break
      case '--floor':
        args.floor = parseInteger(readValue(), '--floor')
        break
      case '--ceiling':
        args.ceiling = parseInteger(readValue(), '--ceiling')
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        die(`unexpected positional argument: ${arg}`)
    }
  }

  if (!args.input) die('--input is required')

  const profile = args.profile.trim().toLowerCase()
  if (!VALID_PROFILES.has(profile)) {
    die(`unsupported profile: ${args.profile}`, 64)
  }
  args.profile = profile

  if (typeof args.floor !== 'undefined' && args.floor < 1) die('--floor must be at least 1')
  if (typeof args.ceiling !== 'undefined' && args.ceiling < 1) die('--ceiling must be at least 1')
  if (typeof args.floor !== 'undefined' && typeof args.ceiling !== 'undefined' && args.floor > args.ceiling) {
    die('--floor cannot be greater than --ceiling')
  }

  return args
}

function validateRouteStats(input) {
  if (!Array.isArray(input)) {
    die('input JSON must be an array of route stats', 3)
  }

  const seen = new Set()
  return input.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      die(`route stats entry ${index + 1} must be an object`, 3)
    }

    const prefix = normalizePrefix(entry.prefix, index)
    if (seen.has(prefix)) die(`duplicate prefix: ${prefix}`, 3)
    seen.add(prefix)

    const p95Rps = validateNumber(entry.p95Rps, 'p95Rps', index, 0)
    const blockedRate = validateNumber(entry.blockedRate, 'blockedRate', index, 0, 1)
    const burstFactor = validateNumber(entry.burstFactor, 'burstFactor', index, 1)

    return {
      prefix,
      p95Rps,
      blockedRate,
      burstFactor,
      originalIndex: index,
    }
  })
}

function normalizePrefix(prefix, index) {
  if (typeof prefix !== 'string') {
    die(`route stats entry ${index + 1} is missing a string prefix`, 3)
  }
  const normalized = prefix.trim()
  if (!normalized) die(`route stats entry ${index + 1} has a blank prefix`, 3)
  if (/[,\s=]/.test(normalized)) die(`route stats entry ${index + 1} has an invalid prefix`, 3)
  return normalized
}

function validateNumber(value, fieldName, index, min, max = Number.POSITIVE_INFINITY) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    die(`route stats entry ${index + 1} has invalid ${fieldName}`, 3)
  }
  if (value < min || value > max) {
    die(`route stats entry ${index + 1} has out-of-range ${fieldName}`, 3)
  }
  return value
}

function clamp(value, floor, ceiling) {
  let next = value
  if (typeof floor === 'number') next = Math.max(next, floor)
  if (typeof ceiling === 'number') next = Math.min(next, ceiling)
  return next
}

export function buildRateLimitSuggestion(routes, profile = 'wedos_medium', bounds = {}) {
  const selectedProfile = PROFILES[profile] || PROFILES.wedos_medium
  const normalizedRoutes = validateRouteStats(routes)

  const entries = normalizedRoutes
    .slice()
    .sort((a, b) => a.prefix.localeCompare(b.prefix) || a.originalIndex - b.originalIndex)
    .map((route) => {
      const burstLift = Math.max(0, route.burstFactor - 1)
      const raw = Math.ceil(
        route.p95Rps * (1 + selectedProfile.headroom + burstLift * selectedProfile.burstWeight) +
          route.blockedRate * selectedProfile.blockedWeight +
          selectedProfile.bias,
      )
      const finalValue = Math.max(1, clamp(raw, bounds.floor, bounds.ceiling))
      return {
        prefix: route.prefix,
        value: finalValue,
        raw,
        rationale: `prefix=${route.prefix} p95Rps=${formatNumber(route.p95Rps)} blockedRate=${formatNumber(route.blockedRate)} burstFactor=${formatNumber(route.burstFactor)} profile=${profile} raw=${raw} final=${finalValue}${formatBounds(bounds)}`,
      }
    })

  return {
    profile,
    suggestion: entries.map((entry) => `${entry.prefix}=${entry.value}`).join(','),
    entries,
  }
}

function formatBounds(bounds) {
  const parts = []
  if (typeof bounds.floor === 'number') parts.push(` floor=${bounds.floor}`)
  if (typeof bounds.ceiling === 'number') parts.push(` ceiling=${bounds.ceiling}`)
  return parts.join('')
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number.parseFloat(value.toFixed(4)))
}

async function readJsonInput(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    die(`failed to read input file: ${message}`, 3)
  }

  try {
    return JSON.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    die(`invalid JSON input: ${message}`, 3)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const input = await readJsonInput(args.input)
  const result = buildRateLimitSuggestion(input, args.profile, {
    floor: args.floor,
    ceiling: args.ceiling,
  })

  console.log(result.suggestion)
  for (const entry of result.entries) {
    console.log(`- ${entry.rationale}`)
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    die(message, 3)
  })
}

export { parseArgs, validateRouteStats }
