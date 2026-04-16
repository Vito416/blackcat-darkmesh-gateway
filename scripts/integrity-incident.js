#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const ACTIONS = new Set(['pause', 'resume', 'ack', 'report', 'state'])
const DEFAULTS = {
  pause: { event: 'manual-freeze', severity: 'critical', source: 'ops' },
  resume: { event: 'manual-unfreeze', severity: 'high', source: 'ops' },
  ack: { event: 'integrity-ack', severity: 'medium', source: 'ops' },
  report: { event: 'integrity-report', severity: 'medium', source: 'ops' },
}

function usage(exitCode = 0) {
  const lines = [
    'Usage:',
    '  node scripts/integrity-incident.js <pause|resume|ack|report|state> --url <gateway-url> [options]',
    '',
    'Options:',
    '  --token-env <NAME>       Env var that holds the auth token',
    '  --token <VALUE>          Direct token override (prefer env vars)',
    '  --event <NAME>           Incident event name (incident actions only)',
    '  --severity <LEVEL>       low|medium|high|critical (incident actions only)',
    '  --source <NAME>          Incident source label (incident actions only)',
    '  --incident-id <ID>       Stable incident id (incident actions only)',
    '  --occurred-at <ISO>      Incident timestamp override (incident actions only)',
    '  --details <JSON|TEXT>    Optional incident details payload (incident actions only)',
    '  --signature-ref <REF>    Add x-signature-ref and body.signatureRef',
    '  --header <K:V>           Extra header; may be repeated',
    '  --dry-run                Print request details without sending curl',
    '  --insecure               Pass curl -k (for local TLS/dev only)',
    '  --help                   Show this help',
    '',
    'Examples:',
    '  GATEWAY_INTEGRITY_INCIDENT_TOKEN=dev-secret \\',
    '    node scripts/integrity-incident.js pause --url http://localhost:8787',
    '',
    '  GATEWAY_INTEGRITY_INCIDENT_TOKEN=prod-secret \\',
    '    node scripts/integrity-incident.js report --url https://gateway.example.com --severity high --event integrity-spike',
    '',
    '  GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \\',
    '    node scripts/integrity-incident.js state --url https://gateway.example.com',
  ]
  console.log(lines.join('\n'))
  process.exit(exitCode)
}

function die(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {
    action: '',
    url: '',
    tokenEnv: '',
    token: '',
    event: '',
    severity: '',
    source: '',
    incidentId: '',
    occurredAt: '',
    details: '',
    signatureRef: '',
    dryRun: false,
    insecure: false,
    headers: [],
  }

  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (arg === '--insecure') {
      args.insecure = true
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
        args.url = readValue()
        break
      case '--token-env':
        args.tokenEnv = readValue()
        break
      case '--token':
        args.token = readValue()
        break
      case '--event':
        args.event = readValue()
        break
      case '--severity':
        args.severity = readValue()
        break
      case '--source':
        args.source = readValue()
        break
      case '--incident-id':
        args.incidentId = readValue()
        break
      case '--occurred-at':
        args.occurredAt = readValue()
        break
      case '--details':
        args.details = readValue()
        break
      case '--signature-ref':
        args.signatureRef = readValue()
        break
      case '--header':
        args.headers.push(readValue())
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        positionals.push(arg)
    }
  }

  if (positionals.length !== 1) die('expected exactly one action')
  args.action = positionals[0].toLowerCase()
  if (!ACTIONS.has(args.action)) die(`unsupported action: ${args.action}`)
  if (!args.url) die('--url is required')

  let parsedUrl
  try {
    parsedUrl = new URL(args.url)
  } catch (_) {
    die(`invalid url: ${args.url}`)
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) die(`unsupported url protocol: ${parsedUrl.protocol}`)

  if (!args.tokenEnv) {
    args.tokenEnv = args.action === 'state' ? 'GATEWAY_INTEGRITY_STATE_TOKEN' : 'GATEWAY_INTEGRITY_INCIDENT_TOKEN'
  }

  return args
}

function resolveToken(args) {
  if (args.token) return args.token
  const value = process.env[args.tokenEnv] || ''
  if (!value) {
    die(`missing token: set ${args.tokenEnv} or pass --token`)
  }
  return value
}

function buildIncidentPayload(args) {
  const defaults = DEFAULTS[args.action] || DEFAULTS.report
  const payload = {
    action: args.action,
    event: args.event || defaults.event,
    severity: args.severity || defaults.severity,
    source: args.source || defaults.source,
  }

  if (args.incidentId) payload.incidentId = args.incidentId
  if (args.occurredAt) payload.occurredAt = args.occurredAt
  if (args.signatureRef) payload.signatureRef = args.signatureRef

  if (args.details) {
    const raw = args.details.trim()
    try {
      payload.details = JSON.parse(raw)
    } catch (_) {
      payload.details = raw
    }
  }

  if (!payload.event || payload.event.length > 128) die('event must be non-empty and at most 128 characters')
  if (!payload.source || payload.source.length > 128) die('source must be non-empty and at most 128 characters')
  if (!['low', 'medium', 'high', 'critical'].includes(payload.severity)) die('severity must be one of low|medium|high|critical')
  if (payload.incidentId && payload.incidentId.length > 128) die('incident-id must be at most 128 characters')

  return payload
}

function buildHeaders(args, token, payload) {
  const headers = ['accept: application/json']
  if (args.action === 'state') {
    headers.push(`authorization: Bearer ${token}`)
  } else {
    headers.push('content-type: application/json')
    headers.push(`authorization: Bearer ${token}`)
    if (args.signatureRef) headers.push(`x-signature-ref: ${args.signatureRef}`)
  }

  for (const header of args.headers) {
    const idx = header.indexOf(':')
    if (idx <= 0) die(`invalid --header value: ${header}`)
    const name = header.slice(0, idx).trim()
    const value = header.slice(idx + 1).trim()
    if (!name || !value) die(`invalid --header value: ${header}`)
    headers.push(`${name.toLowerCase()}: ${value}`)
  }

  if (args.action !== 'state' && args.signatureRef && !payload.signatureRef) {
    payload.signatureRef = args.signatureRef
  }

  return headers
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = resolveToken(args)

  const url = new URL(args.action === 'state' ? '/integrity/state' : '/integrity/incident', args.url).toString()
  const payload = args.action === 'state' ? null : buildIncidentPayload(args)
  const headers = buildHeaders(args, token, payload || {})

  if (args.dryRun) {
    console.log(JSON.stringify({ url, action: args.action, headers, body: payload }, null, 2))
    return
  }

  const curlArgs = ['-sS', '-D', '-', '-o', '-', '-w', '\nHTTP_STATUS:%{http_code}\n']
  if (args.insecure) curlArgs.push('-k')
  curlArgs.push('-X', args.action === 'state' ? 'GET' : 'POST')
  for (const header of headers) curlArgs.push('-H', header)
  if (payload) curlArgs.push('--data-binary', JSON.stringify(payload))
  curlArgs.push(url)

  const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
  if (result.error) {
    die(`failed to execute curl: ${result.error.message}`)
  }

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status)
}

main()
