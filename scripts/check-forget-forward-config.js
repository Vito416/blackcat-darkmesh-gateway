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
  url: 'GATEWAY_FORGET_FORWARD_URL',
  token: 'GATEWAY_FORGET_FORWARD_TOKEN',
  timeoutMs: 'GATEWAY_FORGET_FORWARD_TIMEOUT_MS',
}

const DEFAULT_TIMEOUT_MS = 3000
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 30000

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-forget-forward-config.js [--json] [--strict] [--help]',
    '',
    'Environment:',
    `  ${ENV_VARS.url}      Optional absolute http(s) URL for the per-site forget relay`,
    `  ${ENV_VARS.token}    Optional bearer token; when set it must not be blank`,
    `  ${ENV_VARS.timeoutMs} Optional timeout in ms (validated when set: ${MIN_TIMEOUT_MS}..${MAX_TIMEOUT_MS})`,
    '',
    'Options:',
    '  --json     Print structured JSON only',
    '  --strict   Fail when the config is pending or invalid',
    '  --help     Show this help',
    '',
    'Exit codes:',
    '  0   config is complete, or pending without --strict',
    '  3   invalid config, or pending in --strict mode',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeTrimmedString(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function parseArgs(argv) {
  const args = {
    json: false,
    strict: false,
    help: false,
  }

  for (const arg of argv) {
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
    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function parseAbsoluteHttpUrl(value) {
  const trimmed = normalizeTrimmedString(value)
  if (!trimmed) {
    return { ok: false, value: '', issue: 'GATEWAY_FORGET_FORWARD_URL is not set' }
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        value: trimmed,
        issue: 'GATEWAY_FORGET_FORWARD_URL must use http(s) protocol',
      }
    }
    return { ok: true, value: parsed.toString() }
  } catch (error) {
    return {
      ok: false,
      value: trimmed,
      issue: `GATEWAY_FORGET_FORWARD_URL must be an absolute http(s) URL (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

function parseOptionalToken(value) {
  if (typeof value === 'undefined') {
    return { present: false, ok: true, value: '' }
  }

  const trimmed = normalizeTrimmedString(value)
  if (!trimmed) {
    return {
      present: true,
      ok: false,
      value: '',
      issue: 'GATEWAY_FORGET_FORWARD_TOKEN must not be blank when set',
    }
  }

  return { present: true, ok: true, value: trimmed }
}

function parseOptionalTimeout(value) {
  if (typeof value === 'undefined') {
    return {
      present: false,
      ok: true,
      value: DEFAULT_TIMEOUT_MS,
      source: 'default',
    }
  }

  const trimmed = normalizeTrimmedString(value)
  if (!trimmed) {
    return {
      present: true,
      ok: false,
      value: DEFAULT_TIMEOUT_MS,
      source: 'env',
      issue: 'GATEWAY_FORGET_FORWARD_TIMEOUT_MS must not be blank when set',
    }
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      present: true,
      ok: false,
      value: DEFAULT_TIMEOUT_MS,
      source: 'env',
      issue: 'GATEWAY_FORGET_FORWARD_TIMEOUT_MS must be a positive integer',
    }
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return {
      present: true,
      ok: false,
      value: parsed,
      source: 'env',
      issue: `GATEWAY_FORGET_FORWARD_TIMEOUT_MS must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms`,
    }
  }

  return {
    present: true,
    ok: true,
    value: parsed,
    source: 'env',
  }
}

function inspectForgetForwardConfig(env = process.env) {
  const url = parseAbsoluteHttpUrl(env[ENV_VARS.url])
  const token = parseOptionalToken(env[ENV_VARS.token])
  const timeout = parseOptionalTimeout(env[ENV_VARS.timeoutMs])

  const issues = []
  const warnings = []

  if (!url.ok) {
    if (url.issue === 'GATEWAY_FORGET_FORWARD_URL is not set') {
      warnings.push('forget-forward relay is disabled because the URL is not set')
    } else {
      issues.push(url.issue)
    }
  }

  if (!token.ok && token.present) {
    issues.push(token.issue)
  }

  if (!timeout.ok && timeout.present) {
    issues.push(timeout.issue)
  }

  if (!url.ok && token.present && token.ok) {
    warnings.push('GATEWAY_FORGET_FORWARD_TOKEN is configured but ignored until the URL is set')
  }

  if (!url.ok && timeout.present && timeout.ok) {
    warnings.push('GATEWAY_FORGET_FORWARD_TIMEOUT_MS is configured but ignored until the URL is set')
  }

  const status = issues.length > 0 ? 'blocked' : !url.ok ? 'pending' : 'complete'
  const ok = status === 'complete'

  return {
    ok,
    strict: false,
    status,
    envVars: { ...ENV_VARS },
    values: {
      url: url.ok ? url.value : '',
      token: token.ok && token.present ? token.value : '',
      timeoutMs: timeout.value,
      timeoutSource: timeout.source,
    },
    present: {
      url: url.ok || normalizeTrimmedString(env[ENV_VARS.url]).length > 0,
      token: token.present,
      timeoutMs: timeout.present,
    },
    counts: {
      configuredCount: [url.ok || normalizeTrimmedString(env[ENV_VARS.url]).length > 0, token.present, timeout.present].filter(Boolean).length,
      issueCount: issues.length,
      warningCount: warnings.length,
    },
    issues,
    warnings,
  }
}

function formatHuman(result) {
  const lines = [
    'Forget-forward config',
    `Status: \`${result.status}\``,
    `Forward URL: ${result.present.url ? `\`${result.values.url}\`` : 'missing'}`,
    `Bearer token: ${result.present.token ? 'set' : 'unset'}`,
    `Timeout: ${result.values.timeoutMs}ms (${result.values.timeoutSource})`,
    `Configured fields: ${result.counts.configuredCount}/3`,
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
      return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
    }

    const result = inspectForgetForwardConfig(env)
    const exitCode = result.issues.length > 0 || (args.strict && result.status !== 'complete') ? 3 : 0
    const payload = { ...result, strict: args.strict, ok: result.status === 'complete' }

    if (args.json) {
      return {
        exitCode,
        stdout: `${JSON.stringify(payload, null, 2)}\n`,
        stderr: '',
      }
    }

    return {
      exitCode,
      stdout: `${formatHuman(payload)}\n`,
      stderr: '',
    }
  } catch (error) {
    if (error instanceof CliError) {
      return { exitCode: error.exitCode, stdout: `${usageText()}\n`, stderr: `${error.message}\n` }
    }

    return {
      exitCode: 3,
      stdout: '',
      stderr: `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    }
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const result = runCli()
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}

export {
  DEFAULT_TIMEOUT_MS,
  ENV_VARS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  formatHuman,
  inspectForgetForwardConfig,
  parseAbsoluteHttpUrl,
  parseArgs,
  parseOptionalTimeout,
  parseOptionalToken,
  runCli,
  usageText,
}
