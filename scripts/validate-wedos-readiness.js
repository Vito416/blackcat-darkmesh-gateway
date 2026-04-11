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

const VALID_PROFILES = new Set(['wedos_small', 'wedos_medium', 'diskless'])
const PROFILE_SPECS = {
  wedos_small: {
    label: 'WEDOS small',
    recommendedOverrides: null,
    diskless: false,
    rules: [
      { key: 'GATEWAY_RESOURCE_PROFILE', type: 'enum', allowed: ['wedos_small'] },
      { key: 'AO_INTEGRITY_FETCH_TIMEOUT_MS', type: 'int', min: 1, max: 4000 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS', type: 'int', min: 1, max: 2 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS', type: 'int', min: 1, max: 75 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_JITTER_MS', type: 'int', min: 0, max: 25 },
      { key: 'GATEWAY_CACHE_TTL_MS', type: 'int', min: 1, max: 180000 },
      { key: 'GATEWAY_CACHE_MAX_ENTRY_BYTES', type: 'int', min: 1, max: 131072 },
      { key: 'GATEWAY_CACHE_MAX_ENTRIES', type: 'int', min: 1, max: 128 },
      { key: 'GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT', type: 'int', min: 1, max: 32 },
      { key: 'GATEWAY_CACHE_ADMISSION_MODE', type: 'enum', allowed: ['reject'] },
      { key: 'GATEWAY_RL_WINDOW_MS', type: 'int', exact: 60000 },
      { key: 'GATEWAY_RL_MAX', type: 'int', min: 1, max: 80 },
      { key: 'GATEWAY_RL_MAX_BUCKETS', type: 'int', min: 1, max: 3000 },
      { key: 'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS', type: 'int', min: 1, max: 43200 },
    ],
  },
  wedos_medium: {
    label: 'WEDOS medium',
    recommendedOverrides: 'inbox=80,webhook=240,template=120',
    diskless: false,
    rules: [
      { key: 'GATEWAY_RESOURCE_PROFILE', type: 'enum', allowed: ['wedos_medium'] },
      { key: 'AO_INTEGRITY_FETCH_TIMEOUT_MS', type: 'int', min: 1, max: 5000 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS', type: 'int', min: 1, max: 3 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS', type: 'int', min: 1, max: 100 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_JITTER_MS', type: 'int', min: 0, max: 25 },
      { key: 'GATEWAY_CACHE_TTL_MS', type: 'int', min: 1, max: 300000 },
      { key: 'GATEWAY_CACHE_MAX_ENTRY_BYTES', type: 'int', min: 1, max: 262144 },
      { key: 'GATEWAY_CACHE_MAX_ENTRIES', type: 'int', min: 1, max: 256 },
      { key: 'GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT', type: 'int', min: 1, max: 64 },
      { key: 'GATEWAY_CACHE_ADMISSION_MODE', type: 'enum', allowed: ['reject'] },
      { key: 'GATEWAY_RL_WINDOW_MS', type: 'int', exact: 60000 },
      { key: 'GATEWAY_RL_MAX', type: 'int', min: 1, max: 120 },
      { key: 'GATEWAY_RL_MAX_BUCKETS', type: 'int', min: 1, max: 10000 },
      { key: 'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS', type: 'int', min: 1, max: 86400 },
    ],
  },
  diskless: {
    label: 'Diskless',
    recommendedOverrides: null,
    diskless: true,
    rules: [
      { key: 'GATEWAY_RESOURCE_PROFILE', type: 'enum', allowed: ['diskless'] },
      { key: 'AO_INTEGRITY_FETCH_TIMEOUT_MS', type: 'int', min: 1, max: 4000 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_ATTEMPTS', type: 'int', min: 1, max: 2 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_BACKOFF_MS', type: 'int', min: 1, max: 75 },
      { key: 'AO_INTEGRITY_FETCH_RETRY_JITTER_MS', type: 'int', min: 0, max: 25 },
      { key: 'GATEWAY_CACHE_TTL_MS', type: 'int', min: 1, max: 180000 },
      { key: 'GATEWAY_CACHE_MAX_ENTRY_BYTES', type: 'int', min: 1, max: 131072 },
      { key: 'GATEWAY_CACHE_MAX_ENTRIES', type: 'int', min: 1, max: 128 },
      { key: 'GATEWAY_CACHE_MAX_KEYS_PER_SUBJECT', type: 'int', min: 1, max: 32 },
      { key: 'GATEWAY_CACHE_ADMISSION_MODE', type: 'enum', allowed: ['reject'] },
      { key: 'GATEWAY_RL_WINDOW_MS', type: 'int', exact: 60000 },
      { key: 'GATEWAY_RL_MAX', type: 'int', min: 1, max: 80 },
      { key: 'GATEWAY_RL_MAX_BUCKETS', type: 'int', min: 1, max: 3000 },
      { key: 'GATEWAY_INTEGRITY_CHECKPOINT_MAX_AGE_SECONDS', type: 'int', min: 1, max: 43200 },
    ],
  },
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/validate-wedos-readiness.js --profile wedos_small|wedos_medium|diskless [--env-file <FILE>] [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --profile <NAME>  Hosting profile to validate (required)',
    '  --env-file <FILE> Optional dotenv-style env file to load before validation',
    '  --json            Print JSON only',
    '  --strict          Fail on critical violations (warnings still pass)',
    '  --help            Show this help',
    '',
    'Exit codes:',
    '  0   pass or warn',
    '  3   fail or data error',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    profile: '',
    envFile: '',
    json: false,
    strict: false,
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
    if (arg === '--strict') {
      args.strict = true
      continue
    }

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--profile':
        args.profile = readValue()
        break
      case '--env-file':
        args.envFile = readValue()
        break
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.profile)) {
    throw new CliError('--profile is required', 64)
  }
  if (!VALID_PROFILES.has(args.profile.trim())) {
    throw new CliError(`unknown profile: ${args.profile}`, 64)
  }

  return args
}

function parseEnvFile(text, filePath = '<env-file>') {
  const env = {}
  const lines = text.split(/\r?\n/)

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const original = lines[lineNo]
    const line = original.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const equalsIndex = normalized.indexOf('=')
    if (equalsIndex <= 0) {
      throw new CliError(`invalid env line ${lineNo + 1} in ${filePath}: ${original}`, 64)
    }

    const key = normalized.slice(0, equalsIndex).trim()
    let value = normalized.slice(equalsIndex + 1)
    if (!key) {
      throw new CliError(`invalid env key on line ${lineNo + 1} in ${filePath}`, 64)
    }

    value = value.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    env[key] = value
  }

  return env
}

function loadEnv(argvEnv, envFile) {
  const merged = { ...argvEnv }
  if (isNonEmptyString(envFile)) {
    const text = readFileSync(envFile, 'utf8')
    Object.assign(merged, parseEnvFile(text, envFile))
  }
  return merged
}

function parseIntStrict(value) {
  if (!isNonEmptyString(value) || !/^-?\d+$/.test(value.trim())) return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function addIssue(issues, severity, key, message, fix, actual, expected) {
  issues.push({ severity, key, message, fix, actual, expected })
}

function describeBounds(rule) {
  if (typeof rule.exact === 'number') return `exactly ${rule.exact}`
  const parts = []
  if (typeof rule.min === 'number') parts.push(`>= ${rule.min}`)
  if (typeof rule.max === 'number') parts.push(`<= ${rule.max}`)
  return parts.join(' and ')
}

function validateNumericRule(env, issues, rule, options = {}) {
  const raw = env[rule.key]
  const expected = describeBounds(rule)
  if (!isNonEmptyString(raw)) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} is required for ${options.profileLabel}`,
      `Set ${rule.key} to ${expected}.`,
      'missing',
      expected,
    )
    return
  }

  const parsed = parseIntStrict(raw)
  if (parsed === null) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} must be an integer`,
      `Set ${rule.key} to ${expected}.`,
      raw,
      expected,
    )
    return
  }

  if (typeof rule.exact === 'number' && parsed !== rule.exact) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} must be ${rule.exact} for ${options.profileLabel}`,
      `Set ${rule.key}=${rule.exact}.`,
      String(parsed),
      `exactly ${rule.exact}`,
    )
    return
  }

  if (typeof rule.min === 'number' && parsed < rule.min) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} is too small for ${options.profileLabel} (found ${parsed})`,
      `Raise ${rule.key} to >= ${rule.min}.`,
      String(parsed),
      expected,
    )
    return
  }

  if (typeof rule.max === 'number' && parsed > rule.max) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} is too large for ${options.profileLabel} (found ${parsed})`,
      `Lower ${rule.key} to <= ${rule.max}.`,
      String(parsed),
      expected,
    )
  }
}

function validateEnumRule(env, issues, rule, options = {}) {
  const raw = env[rule.key]
  const expected = `one of: ${rule.allowed.join(', ')}`
  if (!isNonEmptyString(raw)) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} is required for ${options.profileLabel}`,
      `Set ${rule.key} to ${rule.allowed[0]}.`,
      'missing',
      expected,
    )
    return
  }

  const value = raw.trim()
  if (!rule.allowed.includes(value)) {
    addIssue(
      issues,
      'critical',
      rule.key,
      `${rule.key} must be ${expected} for ${options.profileLabel}`,
      `Set ${rule.key}=${rule.allowed[0]}.`,
      value,
      expected,
    )
  }
}

function validateOverrides(env, issues, profileSpec) {
  if (!profileSpec.recommendedOverrides) return
  const raw = env.GATEWAY_RL_MAX_OVERRIDES
  if (!isNonEmptyString(raw)) {
    addIssue(
      issues,
      'warning',
      'GATEWAY_RL_MAX_OVERRIDES',
      `GATEWAY_RL_MAX_OVERRIDES is not set for ${profileSpec.label}`,
      `Set GATEWAY_RL_MAX_OVERRIDES=${profileSpec.recommendedOverrides} for the hot-path caps shown in ops/resource-budgets.md.`,
      'missing',
      profileSpec.recommendedOverrides,
    )
    return
  }

  const entries = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const parsed = new Map()

  for (const entry of entries) {
    const eq = entry.indexOf('=')
    if (eq <= 0) {
      addIssue(
        issues,
        'warning',
        'GATEWAY_RL_MAX_OVERRIDES',
        `GATEWAY_RL_MAX_OVERRIDES contains a malformed entry: ${entry}`,
        `Use comma-separated key=value pairs like ${profileSpec.recommendedOverrides}.`,
        raw,
        profileSpec.recommendedOverrides,
      )
      return
    }
    const key = entry.slice(0, eq).trim()
    const value = parseIntStrict(entry.slice(eq + 1))
    if (!key || value === null || value <= 0) {
      addIssue(
        issues,
        'warning',
        'GATEWAY_RL_MAX_OVERRIDES',
        `GATEWAY_RL_MAX_OVERRIDES contains an invalid entry: ${entry}`,
        `Use comma-separated key=value pairs like ${profileSpec.recommendedOverrides}.`,
        raw,
        profileSpec.recommendedOverrides,
      )
      return
    }
    parsed.set(key, value)
  }

  for (const requiredKey of ['inbox', 'webhook', 'template']) {
    if (!parsed.has(requiredKey)) {
      addIssue(
        issues,
        'warning',
        'GATEWAY_RL_MAX_OVERRIDES',
        `GATEWAY_RL_MAX_OVERRIDES should include ${requiredKey} for ${profileSpec.label}`,
        `Set GATEWAY_RL_MAX_OVERRIDES=${profileSpec.recommendedOverrides}.`,
        raw,
        profileSpec.recommendedOverrides,
      )
      return
    }
  }
}

function validateDisklessGuidance(env, issues, profileSpec) {
  if (!profileSpec.diskless) return

  const mode = env.GATEWAY_INTEGRITY_CHECKPOINT_MODE
  const disklessFlag = env.GATEWAY_INTEGRITY_DISKLESS
  const modeIsDiskless = isNonEmptyString(mode) && mode.trim() === 'diskless'
  const flagIsDiskless = isNonEmptyString(disklessFlag) && ['1', 'true', 'yes'].includes(disklessFlag.trim().toLowerCase())

  if (!modeIsDiskless && !flagIsDiskless) {
    addIssue(
      issues,
      'critical',
      'GATEWAY_INTEGRITY_CHECKPOINT_MODE',
      'diskless profile requires diskless checkpoint handling',
      'Set GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless or GATEWAY_INTEGRITY_DISKLESS=1.',
      modeIsDiskless ? 'diskless' : isNonEmptyString(mode) ? mode : 'missing',
      'diskless checkpoint mode',
    )
  }
}

function evaluateReadiness(profile, env) {
  const profileSpec = PROFILE_SPECS[profile]
  if (!profileSpec) throw new CliError(`unknown profile: ${profile}`, 64)

  const issues = []

  for (const rule of profileSpec.rules) {
    if (rule.type === 'int') validateNumericRule(env, issues, rule, { profileLabel: profileSpec.label })
    else if (rule.type === 'enum') validateEnumRule(env, issues, rule, { profileLabel: profileSpec.label })
  }

  validateOverrides(env, issues, profileSpec)
  validateDisklessGuidance(env, issues, profileSpec)

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const status = criticalCount > 0 ? 'fail' : warningCount > 0 ? 'warn' : 'pass'

  return {
    profile,
    profileLabel: profileSpec.label,
    status,
    criticalCount,
    warningCount,
    totalCount: issues.length,
    issues,
  }
}

function renderHumanReport(result, meta = {}) {
  const lines = []
  lines.push('# WEDOS Readiness')
  lines.push('')
  lines.push(`- Profile: \`${result.profile}\``)
  lines.push(`- Status: \`${result.status}\``)
  lines.push(`- Critical issues: ${result.criticalCount}`)
  lines.push(`- Warnings: ${result.warningCount}`)
  if (meta.envSource) lines.push(`- Env source: \`${meta.envSource}\``)
  lines.push('')

  if (result.issues.length === 0) {
    lines.push('All required hosting knobs are within the requested profile budget.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  const critical = result.issues.filter((issue) => issue.severity === 'critical')
  const warnings = result.issues.filter((issue) => issue.severity === 'warning')

  if (critical.length > 0) {
    lines.push('## Critical issues')
    for (const issue of critical) {
      lines.push(`- [critical] ${issue.message}`)
      lines.push(`  - Expected: ${issue.expected}`)
      lines.push(`  - Actual: ${issue.actual}`)
      lines.push(`  - Fix: ${issue.fix}`)
    }
    lines.push('')
  }

  if (warnings.length > 0) {
    lines.push('## Warnings')
    for (const issue of warnings) {
      lines.push(`- [warning] ${issue.message}`)
      lines.push(`  - Expected: ${issue.expected}`)
      lines.push(`  - Actual: ${issue.actual}`)
      lines.push(`  - Fix: ${issue.fix}`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function renderJsonReport(result, meta = {}) {
  return `${JSON.stringify(
    {
      profile: result.profile,
      profileLabel: result.profileLabel,
      status: result.status,
      strict: Boolean(meta.strict),
      envSource: meta.envSource ?? 'process env',
      counts: {
        critical: result.criticalCount,
        warning: result.warningCount,
        total: result.totalCount,
      },
      issues: result.issues,
    },
    null,
    2,
  )}\n`
}

function runCli(argv = process.argv.slice(2), options = {}) {
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

  let env
  try {
    env = loadEnv(options.env ?? process.env, args.envFile)
  } catch (err) {
    return {
      exitCode: err instanceof CliError ? err.exitCode : 64,
      stdout: usageText(),
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  let result
  try {
    result = evaluateReadiness(args.profile, env)
  } catch (err) {
    return {
      exitCode: err instanceof CliError ? err.exitCode : 3,
      stdout: '',
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  const envSource = isNonEmptyString(args.envFile) ? args.envFile : 'process env'
  const stdout = args.json
    ? renderJsonReport(result, { envSource, strict: args.strict })
    : renderHumanReport(result, { envSource, strict: args.strict })

  const exitCode = result.status === 'fail' ? 3 : 0
  return { exitCode, stdout, stderr: '' }
}

function main() {
  const result = runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) main()

export {
  CliError,
  PROFILE_SPECS,
  evaluateReadiness,
  parseArgs,
  parseEnvFile,
  renderHumanReport,
  renderJsonReport,
  runCli,
  usageText,
}
