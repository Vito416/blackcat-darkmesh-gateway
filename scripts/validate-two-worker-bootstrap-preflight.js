#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
    '  node scripts/validate-two-worker-bootstrap-preflight.js [options]',
    '',
    'Options:',
    '  --secrets-wrangler <path>   Secrets Worker wrangler file (default: workers/secrets-worker/wrangler.toml)',
    '  --async-wrangler <path>     Async Worker wrangler file (default: workers/async-worker/wrangler.toml)',
    '  --check-secrets-env         Also validate required secret env vars from current shell',
    '  --strict                    Treat warnings as failures',
    '  --json                      Print JSON only',
    '  --help                      Show help',
    '',
    'Notes:',
    '  - If wrangler.toml is missing, script auto-falls back to wrangler.toml.example for that worker.',
    '  - This preflight validates config surface only; it does not call Cloudflare APIs.',
    '',
    'Exit codes:',
    '  0   pass',
    '  3   fail',
    '  64  usage error'
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    secretsWrangler: 'workers/secrets-worker/wrangler.toml',
    asyncWrangler: 'workers/async-worker/wrangler.toml',
    checkSecretsEnv: false,
    strict: false,
    json: false,
    help: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

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
    if (arg === '--check-secrets-env') {
      args.checkSecretsEnv = true
      continue
    }

    const readValue = () => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      i += 1
      return value
    }

    if (arg === '--secrets-wrangler') {
      args.secretsWrangler = readValue()
      continue
    }
    if (arg === '--async-wrangler') {
      args.asyncWrangler = readValue()
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function stripTomlComment(line) {
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    if (c === '"' && !inSingle) inDouble = !inDouble
    if (c === '#' && !inSingle && !inDouble) {
      return line.slice(0, i)
    }
  }
  return line
}

function parseTomlScalar(raw) {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function resolveConfigPath(inputPath) {
  const absolute = path.resolve(inputPath)
  if (existsSync(absolute)) {
    return { path: absolute, fallbackUsed: false }
  }

  if (absolute.endsWith('wrangler.toml')) {
    const fallback = `${absolute}.example`
    if (existsSync(fallback)) {
      return { path: fallback, fallbackUsed: true }
    }
  }

  return { path: absolute, fallbackUsed: false, missing: true }
}

function parseWranglerConfig(filePath) {
  const text = readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/)

  const vars = new Map()
  const varSections = new Set(['vars', 'env.production.vars'])
  const kvSections = new Set(['kv_namespaces', 'env.production.kv_namespaces'])
  const doSections = new Set(['durable_objects.bindings', 'env.production.durable_objects.bindings'])

  let section = ''
  const kvBindings = new Set()
  const doBindings = new Set()

  for (const originalLine of lines) {
    const line = stripTomlComment(originalLine).trim()
    if (!line) continue

    const tableMatch = line.match(/^\[\[([^\]]+)\]\]$/)
    if (tableMatch) {
      section = tableMatch[1].trim()
      continue
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }

    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!kvMatch) continue

    const key = kvMatch[1]
    const value = parseTomlScalar(kvMatch[2])

    if (varSections.has(section)) {
      vars.set(key, value)
      continue
    }

    if (kvSections.has(section) && key === 'binding') {
      kvBindings.add(value)
      continue
    }

    if (doSections.has(section) && key === 'name') {
      doBindings.add(value)
    }
  }

  return {
    vars,
    kvBindings,
    doBindings
  }
}

function parseCsv(value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function isPlaceholder(value) {
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  if (!normalized) return true
  return (
    normalized.includes('change-me') ||
    normalized.includes('example.com') ||
    normalized.includes('<') ||
    normalized.includes('todo') ||
    normalized.includes('replace')
  )
}

function checkRequiredVars(label, vars, required, report) {
  for (const key of required) {
    if (!vars.has(key)) {
      report.errors.push(`[${label}] missing required var in wrangler: ${key}`)
      continue
    }
    const value = vars.get(key)
    if (isPlaceholder(value)) {
      report.warnings.push(`[${label}] var ${key} looks like placeholder: ${value}`)
    }
  }
}

function checkBindings(label, cfg, requiredKv, requiredDo, report) {
  for (const binding of requiredKv) {
    if (!cfg.kvBindings.has(binding)) {
      report.errors.push(`[${label}] missing KV binding: ${binding}`)
    }
  }
  for (const binding of requiredDo) {
    if (!cfg.doBindings.has(binding)) {
      report.errors.push(`[${label}] missing Durable Object binding: ${binding}`)
    }
  }
}

function checkAllowlists(report, label, key, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    report.errors.push(`[${label}] ${key} must not be empty`)
    return
  }

  const entries = parseCsv(value)
  if (entries.length === 0) {
    report.errors.push(`[${label}] ${key} must contain at least one host`)
    return
  }

  for (const entry of entries) {
    if (entry.includes('*')) {
      report.errors.push(`[${label}] ${key} contains wildcard entry: ${entry}`)
    }
    if (entry.includes('://')) {
      report.warnings.push(`[${label}] ${key} should contain host entries, got URL-like value: ${entry}`)
    }
  }
}

function checkSecretEnv(report, label, requiredSecretNames) {
  for (const key of requiredSecretNames) {
    const value = process.env[key]
    if (typeof value !== 'string' || value.trim() === '') {
      report.errors.push(`[${label}] missing required secret env in shell: ${key}`)
      continue
    }
    if (isPlaceholder(value)) {
      report.warnings.push(`[${label}] secret env ${key} looks like placeholder`)
    }
  }
}

function runPreflight(args) {
  const report = {
    ok: false,
    strict: args.strict,
    checkedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
    checked: {
      secretsWrangler: '',
      asyncWrangler: '',
      usedExampleFallback: []
    }
  }

  const secretsPathInfo = resolveConfigPath(args.secretsWrangler)
  const asyncPathInfo = resolveConfigPath(args.asyncWrangler)

  if (secretsPathInfo.missing) {
    report.errors.push(`[secrets-worker] wrangler file not found: ${secretsPathInfo.path}`)
  }
  if (asyncPathInfo.missing) {
    report.errors.push(`[async-worker] wrangler file not found: ${asyncPathInfo.path}`)
  }

  report.checked.secretsWrangler = secretsPathInfo.path
  report.checked.asyncWrangler = asyncPathInfo.path

  if (secretsPathInfo.fallbackUsed) report.checked.usedExampleFallback.push('secrets-worker')
  if (asyncPathInfo.fallbackUsed) report.checked.usedExampleFallback.push('async-worker')

  if (report.errors.length > 0) {
    report.ok = false
    return report
  }

  const secretsCfg = parseWranglerConfig(secretsPathInfo.path)
  const asyncCfg = parseWranglerConfig(asyncPathInfo.path)

  checkRequiredVars(
    'secrets-worker',
    secretsCfg.vars,
    [
      'WORKER_STRICT_TOKEN_SCOPES',
      'AUTH_REQUIRE_SIGNATURE',
      'AUTH_REQUIRE_NONCE',
      'REQUIRE_SECRETS',
      'REQUIRE_METRICS_AUTH',
      'HB_ALLOWED_HOSTS'
    ],
    report
  )

  checkRequiredVars(
    'async-worker',
    asyncCfg.vars,
    [
      'REFRESH_DOMAINS',
      'HB_PROBE_ALLOWLIST',
      'DNS_RESOLVER_URL',
      'AR_GATEWAY_URL',
      'AR_GATEWAY_ALLOWLIST',
      'SECRETS_WORKER_BASE_URL',
      'REFRESH_FETCH_TIMEOUT_MS',
      'CONFIG_MAX_BYTES',
      'DNS_RESPONSE_MAX_BYTES',
      'REFRESH_DOMAIN_COOLDOWN_SEC',
      'STALE_GRACE_SEC'
    ],
    report
  )

  checkBindings('secrets-worker', secretsCfg, ['INBOX_KV'], ['REPLAY_LOCKS'], report)
  checkBindings('async-worker', asyncCfg, ['DOMAIN_MAP_KV'], [], report)

  checkAllowlists(report, 'secrets-worker', 'HB_ALLOWED_HOSTS', secretsCfg.vars.get('HB_ALLOWED_HOSTS'))
  checkAllowlists(report, 'async-worker', 'HB_PROBE_ALLOWLIST', asyncCfg.vars.get('HB_PROBE_ALLOWLIST'))
  checkAllowlists(report, 'async-worker', 'AR_GATEWAY_ALLOWLIST', asyncCfg.vars.get('AR_GATEWAY_ALLOWLIST'))

  if (args.checkSecretsEnv) {
    checkSecretEnv(
      report,
      'secrets-worker',
      [
        'WORKER_AUTH_TOKEN',
        'WORKER_READ_TOKEN',
        'WORKER_SIGN_TOKEN',
        'ROUTE_ASSERT_TOKEN',
        'ROUTE_ASSERT_SIGNING_KEY_HEX',
        'ROUTE_ASSERT_INTERNAL_HMAC_SECRET'
      ]
    )

    checkSecretEnv(
      report,
      'async-worker',
      [
        'JOBS_AUTH_TOKEN',
        'MAILER_AUTH_TOKEN',
        'ROUTE_ASSERT_TOKEN',
        'ROUTE_ASSERT_INTERNAL_HMAC_SECRET'
      ]
    )
  }

  report.ok = report.errors.length === 0 && (!args.strict || report.warnings.length === 0)
  return report
}

function printHuman(report) {
  console.log('Two-worker bootstrap preflight')
  console.log(`- Secrets wrangler: ${report.checked.secretsWrangler}`)
  console.log(`- Async wrangler: ${report.checked.asyncWrangler}`)
  if (report.checked.usedExampleFallback.length > 0) {
    console.log(`- Used fallback templates: ${report.checked.usedExampleFallback.join(', ')}`)
  }

  if (report.warnings.length > 0) {
    console.log(`- Warnings: ${report.warnings.length}`)
    for (const warning of report.warnings) {
      console.log(`  WARN ${warning}`)
    }
  }

  if (report.errors.length > 0) {
    console.log(`- Errors: ${report.errors.length}`)
    for (const error of report.errors) {
      console.log(`  FAIL ${error}`)
    }
  }

  console.log(report.ok ? 'Preflight passed.' : 'Preflight failed.')
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2))

    if (args.help) {
      console.log(usageText())
      process.exit(0)
    }

    const report = runPreflight(args)

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      printHuman(report)
    }

    process.exit(report.ok ? 0 : 3)
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message)
      process.exit(error.exitCode)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(3)
  }
}

main()
