#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
    '  node scripts/probe-ao-read-fallback.js --dryrun-base <URL> --scheduler-base <URL> --site-id <ID> [options]',
    '',
    'Options:',
    '  --dryrun-base <URL>      AO read adapter base URL for dryrun-preferred profile',
    '  --scheduler-base <URL>   AO read adapter base URL for scheduler-fallback profile',
    '  --site-id <ID>           Site ID used for probe payloads',
    '  --path <PATH>            Route path used by resolve-route probe (default: /)',
    '  --slug <SLUG>            Slug used by get-page probe (default: home)',
    '  --token <VALUE>          Optional token for Authorization + x-api-token',
    '  --out-dir <DIR>          Evidence output directory (default: ops/decommission)',
    '  --prefix <NAME>          Output filename prefix (default: ao-read-fallback-probe)',
    '  --timeout-ms <N>         Request timeout in ms (default: 12000)',
    '  --json                   Print JSON only',
    '  --strict                 Exit non-zero for pending state (missing mode evidence)',
    '  --help                   Show this help',
    '',
    'Exit codes:',
    '  0   probe passed (or pending without --strict)',
    '  3   probe failed (or pending with --strict)',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parsePositiveInt(value, fallback, flagName) {
  if (!isNonEmptyString(value)) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${flagName} must be a positive integer`, 64)
  }
  return parsed
}

function normalizeUrl(value, flagName) {
  if (!isNonEmptyString(value)) {
    throw new CliError(`${flagName} is required`, 64)
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new CliError(`${flagName} must be a valid URL`, 64)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new CliError(`${flagName} must use http or https`, 64)
  }
  return parsed.toString().replace(/\/+$/, '')
}

function parseArgs(argv) {
  const args = {
    dryrunBase: '',
    schedulerBase: '',
    siteId: '',
    path: '/',
    slug: 'home',
    token: '',
    outDir: 'ops/decommission',
    prefix: 'ao-read-fallback-probe',
    timeoutMs: 12000,
    strict: false,
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
    if (arg === '--strict') {
      args.strict = true
      continue
    }

    const readValue = () => {
      const next = argv[index + 1]
      if (!isNonEmptyString(next) || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    if (arg === '--dryrun-base' || arg.startsWith('--dryrun-base=')) {
      args.dryrunBase = arg === '--dryrun-base' ? readValue() : arg.slice('--dryrun-base='.length)
      continue
    }
    if (arg === '--scheduler-base' || arg.startsWith('--scheduler-base=')) {
      args.schedulerBase = arg === '--scheduler-base' ? readValue() : arg.slice('--scheduler-base='.length)
      continue
    }
    if (arg === '--site-id' || arg.startsWith('--site-id=')) {
      args.siteId = arg === '--site-id' ? readValue() : arg.slice('--site-id='.length)
      continue
    }
    if (arg === '--path' || arg.startsWith('--path=')) {
      args.path = arg === '--path' ? readValue() : arg.slice('--path='.length)
      continue
    }
    if (arg === '--slug' || arg.startsWith('--slug=')) {
      args.slug = arg === '--slug' ? readValue() : arg.slice('--slug='.length)
      continue
    }
    if (arg === '--token' || arg.startsWith('--token=')) {
      args.token = arg === '--token' ? readValue() : arg.slice('--token='.length)
      continue
    }
    if (arg === '--out-dir' || arg.startsWith('--out-dir=')) {
      args.outDir = arg === '--out-dir' ? readValue() : arg.slice('--out-dir='.length)
      continue
    }
    if (arg === '--prefix' || arg.startsWith('--prefix=')) {
      args.prefix = arg === '--prefix' ? readValue() : arg.slice('--prefix='.length)
      continue
    }
    if (arg === '--timeout-ms' || arg.startsWith('--timeout-ms=')) {
      const raw = arg === '--timeout-ms' ? readValue() : arg.slice('--timeout-ms='.length)
      args.timeoutMs = parsePositiveInt(raw, args.timeoutMs, '--timeout-ms')
      continue
    }

    if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  args.dryrunBase = normalizeUrl(args.dryrunBase, '--dryrun-base')
  args.schedulerBase = normalizeUrl(args.schedulerBase, '--scheduler-base')
  args.siteId = trimString(args.siteId)
  if (!args.siteId) throw new CliError('--site-id is required', 64)
  args.path = trimString(args.path) || '/'
  args.path = args.path.startsWith('/') ? args.path : `/${args.path}`
  args.slug = trimString(args.slug) || 'home'
  args.outDir = resolve(args.outDir)
  args.prefix = trimString(args.prefix) || 'ao-read-fallback-probe'
  return args
}

function buildProbeRequests(args) {
  return [
    {
      action: 'ResolveRoute',
      endpoint: '/api/public/resolve-route',
      body: {
        siteId: args.siteId,
        payload: {
          siteId: args.siteId,
          path: args.path,
        },
      },
    },
    {
      action: 'GetPage',
      endpoint: '/api/public/page',
      body: {
        siteId: args.siteId,
        payload: {
          siteId: args.siteId,
          slug: args.slug,
        },
      },
    },
  ]
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function runProbeSet(label, baseUrl, args) {
  const requests = buildProbeRequests(args)
  const results = []
  for (const req of requests) {
    const url = `${baseUrl}${req.endpoint}`
    const headers = {
      'content-type': 'application/json',
      'x-request-id': `probe-${label.toLowerCase()}-${req.action.toLowerCase()}`,
      'x-trace-id': `probe-${label.toLowerCase()}-trace-${req.action.toLowerCase()}`,
    }
    if (args.token) {
      headers.authorization = `Bearer ${args.token}`
      headers['x-api-token'] = args.token
    }

    const startedAt = new Date().toISOString()
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(req.body),
        },
        args.timeoutMs,
      )
      const rawBody = await response.text().catch(() => '')
      let parsedBody = null
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null
      } catch {
        parsedBody = null
      }

      results.push({
        profile: label,
        action: req.action,
        endpoint: req.endpoint,
        url,
        status: response.status,
        ok: response.ok,
        startedAt,
        finishedAt: new Date().toISOString(),
        transportMode: trimString(parsedBody?.transport?.mode),
        parseOk: parsedBody !== null && typeof parsedBody === 'object',
        body: parsedBody,
        bodyPreview: parsedBody === null ? rawBody.slice(0, 220) : undefined,
      })
    } catch (error) {
      results.push({
        profile: label,
        action: req.action,
        endpoint: req.endpoint,
        url,
        status: 0,
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        transportMode: '',
        parseOk: false,
        body: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

function summarize(results, args) {
  const issues = []
  const warnings = []

  for (const item of results) {
    if (item.error) {
      issues.push(`[${item.profile}/${item.action}] request failed: ${item.error}`)
      continue
    }
    if (!item.parseOk) {
      issues.push(`[${item.profile}/${item.action}] response is not valid JSON`)
      continue
    }
    if (item.status >= 500) {
      issues.push(`[${item.profile}/${item.action}] upstream returned ${item.status}`)
    }
  }

  const dryrunModes = results
    .filter((item) => item.profile === 'dryrun')
    .map((item) => item.transportMode)
    .filter((value) => !!value)
  const schedulerModes = results
    .filter((item) => item.profile === 'scheduler')
    .map((item) => item.transportMode)
    .filter((value) => !!value)

  if (!dryrunModes.includes('dryrun')) {
    warnings.push('dryrun profile did not expose transport.mode=dryrun (run AO adapter with debug transport visibility)')
  }
  if (!schedulerModes.some((value) => value === 'scheduler' || value === 'scheduler-direct')) {
    warnings.push(
      'scheduler profile did not expose transport.mode=scheduler/scheduler-direct (run AO adapter with fallback enabled + debug transport visibility)',
    )
  }

  let status = 'pass'
  if (issues.length > 0) {
    status = 'fail'
  } else if (warnings.length > 0) {
    status = 'pending'
  }

  const now = new Date().toISOString()
  return {
    status,
    strict: args.strict,
    checkedAtUtc: now,
    siteId: args.siteId,
    path: args.path,
    slug: args.slug,
    profiles: {
      dryrun: args.dryrunBase,
      scheduler: args.schedulerBase,
    },
    counts: {
      probeCount: results.length,
      issueCount: issues.length,
      warningCount: warnings.length,
    },
    issues,
    warnings,
    probes: results,
  }
}

function renderMarkdown(summary) {
  const lines = []
  lines.push('# AO Read Fallback Chaos Probe')
  lines.push('')
  lines.push(`- Checked: ${summary.checkedAtUtc}`)
  lines.push(`- Status: ${summary.status}`)
  lines.push(`- Site: ${summary.siteId}`)
  lines.push(`- Resolve path: ${summary.path}`)
  lines.push(`- Page slug: ${summary.slug}`)
  lines.push(`- Dryrun base: ${summary.profiles.dryrun}`)
  lines.push(`- Scheduler base: ${summary.profiles.scheduler}`)
  lines.push('')
  lines.push('## Probe matrix')
  lines.push('')
  lines.push('| Profile | Action | Status | Transport mode | Parse OK |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const item of summary.probes) {
    lines.push(
      `| ${item.profile} | ${item.action} | ${item.status} | ${item.transportMode || 'n/a'} | ${item.parseOk ? 'yes' : 'no'} |`,
    )
  }
  if (summary.issues.length > 0) {
    lines.push('')
    lines.push('## Issues')
    lines.push('')
    for (const issue of summary.issues) lines.push(`- ${issue}`)
  }
  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('## Warnings')
    lines.push('')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
  }
  lines.push('')
  return `${lines.join('\n')}`
}

function writeEvidence(summary, args) {
  mkdirSync(args.outDir, { recursive: true })
  const jsonPath = resolve(args.outDir, `${args.prefix}.json`)
  const mdPath = resolve(args.outDir, `${args.prefix}.md`)
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  writeFileSync(mdPath, renderMarkdown(summary), 'utf8')
  return { jsonPath, mdPath }
}

function renderHuman(summary, evidence) {
  const lines = []
  lines.push(`AO read fallback probe: ${summary.status}`)
  lines.push(`Checked: ${summary.checkedAtUtc}`)
  lines.push(`Issues: ${summary.counts.issueCount}`)
  lines.push(`Warnings: ${summary.counts.warningCount}`)
  lines.push(`Evidence JSON: ${evidence.jsonPath}`)
  lines.push(`Evidence Markdown: ${evidence.mdPath}`)
  if (summary.issues.length > 0) {
    lines.push('')
    lines.push('Issues:')
    for (const issue of summary.issues) lines.push(`- ${issue}`)
  }
  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('Warnings:')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
  }
  return `${lines.join('\n')}\n`
}

export async function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: `${usageText()}\n`,
        stderr: error.exitCode === 0 ? '' : `error: ${error.message}\n`,
      }
    }
    return {
      exitCode: 64,
      stdout: `${usageText()}\n`,
      stderr: `error: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }

  if (args.help) {
    return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
  }

  try {
    const dryrunResults = await runProbeSet('dryrun', args.dryrunBase, args)
    const schedulerResults = await runProbeSet('scheduler', args.schedulerBase, args)
    const summary = summarize([...dryrunResults, ...schedulerResults], args)
    const evidence = writeEvidence(summary, args)

    const out = args.json
      ? `${JSON.stringify({ ...summary, evidence }, null, 2)}\n`
      : renderHuman(summary, evidence)

    const blocked = summary.status === 'fail' || (summary.status === 'pending' && args.strict)
    return { exitCode: blocked ? 3 : 0, stdout: out, stderr: '' }
  } catch (error) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

const isMainModule = (() => {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  } catch {
    return false
  }
})()

if (isMainModule) {
  runCli().then(({ exitCode, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    if (exitCode !== 0) process.exit(exitCode)
  })
}
