#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import {
  COMPARED_FIELDS,
  buildComparisonReport,
  parseGatewayUrls,
  resolveTokensForUrls,
} from './lib/compare-integrity-state-core.js'

const VALID_MODES = new Set(['pairwise', 'all'])

function usage() {
  return [
    'Usage:',
    '  node scripts/compare-integrity-matrix.js --url <gateway-url> --url <gateway-url> [--token <VALUE> ...] [--mode pairwise|all] [--json]',
    '',
    'Options:',
    '  --url <URL>        Gateway base URL; repeat at least twice',
    '  --token <VALUE>    Optional auth token; repeat once for all URLs or once per URL',
    '  --allow-anon       Allow anonymous /integrity/state requests when no token is configured',
    '  --mode <MODE>      pairwise (default) or all',
    '  --json             Emit machine-readable JSON output',
    '  --help             Show this help',
    '',
    'Pairwise mode:',
    '  compares adjacent gateways only: (1,2), (2,3), ..., (n-1,n)',
    '',
    'All mode:',
    '  compares one matrix run across all provided gateways',
    '',
    'Auth token fallback:',
    '  GATEWAY_INTEGRITY_STATE_TOKEN',
    '',
    'Examples:',
    '  GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \\',
    '    node scripts/compare-integrity-matrix.js --url https://gw-a.example.com --url https://gw-b.example.com',
    '',
    '  node scripts/compare-integrity-matrix.js \\',
    '    --url https://gw-a.example.com --url https://gw-b.example.com --url https://gw-c.example.com \\',
    '    --mode pairwise --token shared-token',
    '',
    '  node scripts/compare-integrity-matrix.js \\',
    '    --url https://gw-a.example.com --url https://gw-b.example.com --url https://gw-c.example.com \\',
    '    --mode all --json',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    help: false,
    urls: [],
    tokens: [],
    allowAnon: false,
    mode: 'pairwise',
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true }
    }

    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '--allow-anon') {
      args.allowAnon = true
      continue
    }

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new Error(`missing value for ${arg}`)
      }
      i += 1
      return next
    }

    switch (arg) {
      case '--url':
        args.urls.push(readValue())
        break
      case '--token':
        args.tokens.push(readValue())
        break
      case '--mode': {
        const mode = readValue()
        if (!VALID_MODES.has(mode)) {
          throw new Error(`invalid --mode value: ${mode}`)
        }
        args.mode = mode
        break
      }
      default:
        if (arg.startsWith('--')) {
          throw new Error(`unknown option: ${arg}`)
        }
        throw new Error(`unexpected positional argument: ${arg}`)
    }
  }

  return args
}

function pad(value, width) {
  const text = String(value)
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

function previewText(text, limit = 260) {
  if (typeof text !== 'string') return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function formatGatewayLabel(url, index) {
  const parsed = new URL(url)
  const host = parsed.host || parsed.hostname || 'gateway'
  return `#${index + 1} ${host}`
}

function buildRunPlan(urls, mode = 'pairwise') {
  if (mode === 'all') {
    return [
      {
        type: 'all',
        name: 'all',
        indices: urls.map((_, index) => index),
      },
    ]
  }

  const runs = []
  for (let index = 0; index < urls.length - 1; index += 1) {
    runs.push({
      type: 'pairwise',
      name: `pair-${index + 1}`,
      indices: [index, index + 1],
    })
  }
  return runs
}

async function fetchState(url, token, fetchImpl = globalThis.fetch) {
  const headers = { accept: 'application/json' }
  if (typeof token === 'string' && token.trim()) {
    headers.authorization = `Bearer ${token}`
  }

  const res = await fetchImpl(new URL('/integrity/state', url), { headers })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || 'response'}: ${previewText(text)}`)
  }

  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch (err) {
    throw new Error(`invalid JSON response: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!json || typeof json !== 'object') {
    throw new Error('response was not a JSON object')
  }

  return json
}

function summarizeRun(report, errors) {
  if (errors.length > 0) {
    return {
      status: 'FAIL',
      outcome: 'failure',
      reason: errors.join('; '),
      mismatches: 0,
      invalid: false,
      totalFields: COMPARED_FIELDS.length,
      report: null,
    }
  }

  if (report.invalid) {
    return {
      status: 'FAIL',
      outcome: 'failure',
      reason: 'one or more snapshots were incomplete',
      mismatches: report.mismatches,
      invalid: true,
      totalFields: report.totalFields,
      report,
    }
  }

  if (report.mismatches > 0) {
    return {
      status: 'MISMATCH',
      outcome: 'mismatch',
      reason: `${report.mismatches} field(s) differ`,
      mismatches: report.mismatches,
      invalid: false,
      totalFields: report.totalFields,
      report,
    }
  }

  return {
    status: 'PASS',
    outcome: 'pass',
    reason: 'all compared fields match',
    mismatches: 0,
    invalid: false,
    totalFields: report.totalFields,
    report,
  }
}

async function compareMatrix({
  urls,
  tokens = [],
  mode = 'pairwise',
  fetchImpl = globalThis.fetch,
  envToken = '',
  allowAnon = false,
}) {
  const normalizedUrls = parseGatewayUrls(urls)
  const normalizedTokens = resolveTokensForUrls(normalizedUrls, tokens, envToken, {
    allowAnonymous: allowAnon,
  })
  const runPlan = buildRunPlan(normalizedUrls, mode)

  const snapshots = await Promise.allSettled(
    normalizedUrls.map((url, index) => fetchState(url, normalizedTokens[index], fetchImpl)),
  )

  const urlResults = normalizedUrls.map((url, index) => {
    const settled = snapshots[index]
    if (settled.status === 'fulfilled') {
      return {
        index,
        url,
        label: formatGatewayLabel(url, index),
        ok: true,
        snapshot: settled.value,
        error: null,
      }
    }

    return {
      index,
      url,
      label: formatGatewayLabel(url, index),
      ok: false,
      snapshot: null,
      error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
    }
  })

  const runs = runPlan.map((plan, runIndex) => {
    const runEntries = plan.indices.map((index) => urlResults[index])
    const errors = runEntries.filter((entry) => !entry.ok).map((entry) => `${entry.label}: ${entry.error}`)

    if (errors.length > 0) {
      return {
        index: runIndex + 1,
        mode,
        type: plan.type,
        name: plan.name,
        indices: plan.indices,
        labels: runEntries.map((entry) => entry.label),
        urls: runEntries.map((entry) => entry.url),
        ...summarizeRun(
          {
            invalid: false,
            mismatches: 0,
            totalFields: COMPARED_FIELDS.length,
            rows: [],
          },
          errors,
        ),
        report: null,
      }
    }

    const report = buildComparisonReport(
      runEntries.map((entry) => ({
        label: entry.label,
        snapshot: entry.snapshot,
      })),
    )

    const summary = summarizeRun(report, [])
    return {
      index: runIndex + 1,
      mode,
      type: plan.type,
      name: plan.name,
      indices: plan.indices,
      labels: runEntries.map((entry) => entry.label),
      urls: runEntries.map((entry) => entry.url),
      ...summary,
      report,
    }
  })

  const counts = runs.reduce(
    (acc, run) => {
      acc.total += 1
      acc[run.outcome] += 1
      return acc
    },
    { total: 0, pass: 0, mismatch: 0, failure: 0 },
  )

  const exitCode = counts.failure > 0 ? 2 : counts.mismatch > 0 ? 3 : 0

  return {
    mode,
    pairingStrategy: mode === 'pairwise' ? 'adjacent' : 'all',
    urls: normalizedUrls,
    tokensMode:
      tokens.length === 1
        ? 'shared'
        : tokens.length === normalizedUrls.length
          ? 'per-url'
          : envToken
            ? 'env-shared'
            : allowAnon
              ? 'anonymous'
              : 'none',
    comparedFields: COMPARED_FIELDS.map(([field]) => field),
    runPlan: runPlan.map((plan) => ({ type: plan.type, name: plan.name, indices: plan.indices })),
    runs,
    counts,
    exitCode,
  }
}

function renderHumanSummary(summary) {
  const lines = []
  lines.push('Integrity matrix comparison')
  lines.push(`Mode: ${summary.mode} (${summary.pairingStrategy})`)
  lines.push(`Gateways: ${summary.urls.length}`)
  lines.push(`Runs: ${summary.counts.total}`)
  lines.push('')

  for (const run of summary.runs) {
    const label = run.labels.join(' <-> ')
    lines.push(`Run ${run.index}/${summary.runs.length}: ${run.status} ${label}`)
    if (run.reason) {
      lines.push(`  Reason: ${run.reason}`)
    }

    if (run.report && (run.report.invalid || run.report.mismatches > 0)) {
      const fieldWidth = Math.max(...COMPARED_FIELDS.map(([field]) => field.length), 22)
      const statusWidth = 10
      lines.push(`  ${pad('Field', fieldWidth)}  ${pad('Status', statusWidth)}  Values`)
      lines.push(`  ${'-'.repeat(fieldWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(40)}`)
      for (const row of run.report.rows) {
        lines.push(`  ${pad(row.field, fieldWidth)}  ${pad(row.status, statusWidth)}  ${row.details}`)
      }
    }

    lines.push('')
  }

  lines.push(
    `Aggregate: ${summary.counts.pass} pass, ${summary.counts.mismatch} mismatch, ${summary.counts.failure} failure`,
  )
  lines.push(`Exit code: ${summary.exitCode}`)
  return lines.join('\n')
}

function renderJsonSummary(summary) {
  return JSON.stringify(summary, null, 2)
}

async function runCli(argv, env = process.env, fetchImpl = globalThis.fetch) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 64, output: `${message}\n\n${usage()}` }
  }

  if (args.help) {
    return { exitCode: 0, output: usage() }
  }

  try {
    const summary = await compareMatrix({
      urls: args.urls,
      tokens: args.tokens,
      mode: args.mode,
      fetchImpl,
      envToken: env.GATEWAY_INTEGRITY_STATE_TOKEN || '',
      allowAnon: args.allowAnon,
    })

    return {
      exitCode: summary.exitCode,
      output: args.json ? renderJsonSummary(summary) : renderHumanSummary(summary),
      summary,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 64, output: `${message}\n\n${usage()}` }
  }
}

async function main() {
  const result = await runCli(process.argv.slice(2), process.env, globalThis.fetch)
  if (result.output) {
    console.log(result.output)
  }
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    process.exit(64)
  })
}

export {
  buildRunPlan,
  compareMatrix,
  fetchState,
  formatGatewayLabel,
  parseArgs,
  renderHumanSummary,
  renderJsonSummary,
  runCli,
  usage,
}
