#!/usr/bin/env node
import {
  COMPARED_FIELDS,
  buildComparisonReport,
  parseGatewayUrls,
  resolveTokensForUrls,
} from './lib/compare-integrity-state-core.js'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/compare-integrity-state.js --url <gateway-url> --url <gateway-url> [--token <VALUE> ...]',
      '',
      'Options:',
      '  --url <URL>        Gateway base URL; repeat at least twice',
      '  --token <VALUE>    Optional auth token; repeat once per URL or once for all URLs',
      '  --allow-anon       Allow anonymous /integrity/state requests when no token is configured',
      '  --help             Show this help',
      '',
      'Auth token fallback:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN',
      '',
      'Examples:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \\',
      '    node scripts/compare-integrity-state.js --url https://gw-a.example.com --url https://gw-b.example.com',
      '',
      '  node scripts/compare-integrity-state.js \\',
      '    --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '    --token token-a --token token-b',
      '',
      '  node scripts/compare-integrity-state.js \\',
      '    --url https://gw-a.example.com --url https://gw-b.example.com --url https://gw-c.example.com \\',
      '    --token shared-token',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function parseArgs(argv) {
  const args = {
    urls: [],
    tokens: [],
    allowAnon: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--allow-anon') {
      args.allowAnon = true
      continue
    }

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`)
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
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        die(`unexpected positional argument: ${arg}`)
    }
  }

  return args
}

async function fetchState(url, token) {
  const headers = { accept: 'application/json' }
  if (typeof token === 'string' && token.trim()) {
    headers.authorization = `Bearer ${token}`
  }
  const res = await fetch(new URL('/integrity/state', url), { headers })
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
  if (!json || typeof json !== 'object') throw new Error('response was not a JSON object')
  return json
}

function previewText(text, limit = 280) {
  if (typeof text !== 'string') return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function formatGatewayLabel(url, index) {
  const parsed = new URL(url)
  const host = parsed.host || parsed.hostname || 'gateway'
  return `#${index + 1} ${host}`
}

function printReport(results) {
  console.log('Integrity state comparison')
  const labelWidth = Math.max(...results.map((r) => r.label.length), 6)
  for (const result of results) {
    console.log(`- ${pad(result.label, labelWidth)}  ${result.url}`)
  }
  console.log('')

  const fieldWidth = Math.max(...COMPARED_FIELDS.map(([field]) => field.length), 22)
  const statusWidth = 10

  console.log(`${pad('Field', fieldWidth)}  ${pad('Status', statusWidth)}  Values`)
  console.log(`${'-'.repeat(fieldWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(40)}`)

  const report = buildComparisonReport(results, COMPARED_FIELDS)
  for (const row of report.rows) {
    console.log(`${pad(row.field, fieldWidth)}  ${pad(row.status, statusWidth)}  ${row.details}`)
  }

  console.log('')
  if (report.invalid) {
    console.log(`Result: INVALID (${report.mismatches}/${report.totalFields} fields mismatched; one or more snapshots were incomplete)`)
  } else {
    console.log(`Result: ${report.mismatches === 0 ? 'CONSISTENT' : 'MISMATCHES'} (${report.mismatches}/${report.totalFields} fields differ)`)
  }
  return report
}

function pad(value, width) {
  const text = String(value)
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const urls = parseGatewayUrls(args.urls)
  const tokens = resolveTokensForUrls(urls, args.tokens, process.env.GATEWAY_INTEGRITY_STATE_TOKEN || '', {
    allowAnonymous: args.allowAnon,
  })

  const results = []
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]
    const token = tokens[i]
    try {
      const snapshot = await fetchState(url, token)
      results.push({ url, label: formatGatewayLabel(url, i), snapshot })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      die(`request failure for ${url}: ${message}`, 2)
    }
  }

  const report = printReport(results)
  process.exit(report.invalid ? 2 : report.mismatches === 0 ? 0 : 3)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
