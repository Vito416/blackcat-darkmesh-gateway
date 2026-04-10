#!/usr/bin/env node

const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const COMPARED_FIELDS = [
  ['policy.paused', ['policy', 'paused']],
  ['policy.activeRoot', ['policy', 'activeRoot']],
  ['policy.activePolicyHash', ['policy', 'activePolicyHash']],
  ['release.version', ['release', 'version']],
  ['release.root', ['release', 'root']],
  ['audit.seqTo', ['audit', 'seqTo']],
]

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/compare-integrity-state.js --url <gateway-url> --url <gateway-url> [--token <VALUE> ...]',
      '',
      'Options:',
      '  --url <URL>        Gateway base URL; repeat at least twice',
      '  --token <VALUE>    Optional auth token; repeat once per URL or once for all URLs',
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

  if (args.urls.length < 2) die('at least two --url values are required')
  for (const url of args.urls) {
    validateUrl(url)
  }

  for (const token of args.tokens) {
    if (typeof token !== 'string' || !token.trim()) die('--token values must not be blank')
  }

  if (args.tokens.length > 0 && args.tokens.length !== 1 && args.tokens.length !== args.urls.length) {
    die('pass either one --token for all URLs or one --token per URL')
  }

  return args
}

function validateUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch (_) {
    die(`invalid url: ${value}`)
  }
  if (!VALID_PROTOCOLS.has(parsed.protocol)) die(`unsupported url protocol: ${value}`)
  return parsed.toString()
}

function resolveToken(args, index) {
  if (args.tokens.length === args.urls.length) return args.tokens[index]
  if (args.tokens.length === 1) return args.tokens[0]
  const envToken = process.env.GATEWAY_INTEGRITY_STATE_TOKEN || ''
  if (!envToken.trim()) {
    die('missing token: set GATEWAY_INTEGRITY_STATE_TOKEN or pass --token')
  }
  return envToken
}

async function fetchState(url, token) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
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

function getField(snapshot, path) {
  let current = snapshot
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return { found: false }
    current = current[key]
  }
  return { found: true, value: current }
}

function formatValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
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

  let mismatches = 0
  let invalid = false
  for (const [field, path] of COMPARED_FIELDS) {
    const values = results.map((result) => getField(result.snapshot, path))
    const missing = values.find((entry) => !entry.found)
    if (missing) {
      invalid = true
      console.log(`${pad(field, fieldWidth)}  ${pad('INVALID', statusWidth)}  missing field in one or more snapshots`)
      continue
    }

    const rendered = values.map((entry) => entry.value)
    const consensus = rendered.every((value) => Object.is(value, rendered[0]))
    if (!consensus) mismatches += 1
    const status = consensus ? 'CONSENSUS' : 'MISMATCH'
    const details = rendered.map((value, idx) => `${results[idx].label}=${formatValue(value)}`).join(' | ')
    console.log(`${pad(field, fieldWidth)}  ${pad(status, statusWidth)}  ${details}`)
  }

  console.log('')
  if (invalid) {
    console.log(`Result: INVALID (${mismatches}/${COMPARED_FIELDS.length} fields mismatched; one or more snapshots were incomplete)`)
  } else {
    console.log(`Result: ${mismatches === 0 ? 'CONSISTENT' : 'MISMATCHES'} (${mismatches}/${COMPARED_FIELDS.length} fields differ)`)
  }
  return { mismatches, invalid }
}

function pad(value, width) {
  const text = String(value)
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const results = []
  for (let i = 0; i < args.urls.length; i += 1) {
    const url = validateUrl(args.urls[i])
    const token = resolveToken(args, i)
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
