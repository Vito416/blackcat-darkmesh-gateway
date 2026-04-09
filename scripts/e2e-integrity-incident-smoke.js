#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 10_000
const INCIDENT_URL_PATH = '/integrity/incident'
const STATE_URL_PATH = '/integrity/state'
const TEMPLATE_URL_PATH = '/template/call'
const WRITE_ACTION = 'checkout.create-order'
const WRITE_PAYLOAD = {
  siteId: 'smoke-site',
  items: [{ sku: 'smoke-sku', qty: 1 }],
}

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/e2e-integrity-incident-smoke.js --base-url <gateway-url>',
      '',
      'Required env vars:',
      '  GATEWAY_BASE_URL                 Base gateway URL if --base-url is not passed',
      '',
      'Optional env vars:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN     Token for /integrity/state',
      '  GATEWAY_INTEGRITY_INCIDENT_TOKEN  Token for /integrity/incident',
      '  GATEWAY_TEMPLATE_TOKEN            Token for /template/call',
      '  GATEWAY_SMOKE_TIMEOUT_MS          Request timeout in milliseconds (default 10000)',
      '',
      'Optional flags:',
      '  --base-url <URL>                 Override GATEWAY_BASE_URL',
      '  --state-token <VALUE>            Override GATEWAY_INTEGRITY_STATE_TOKEN',
      '  --incident-token <VALUE>         Override GATEWAY_INTEGRITY_INCIDENT_TOKEN',
      '  --template-token <VALUE>         Override GATEWAY_TEMPLATE_TOKEN',
      '  --timeout-ms <MS>                Override GATEWAY_SMOKE_TIMEOUT_MS',
      '  --help                           Show this help',
      '',
      'Example:',
      '  GATEWAY_BASE_URL=http://localhost:8787 \\',
      '  GATEWAY_INTEGRITY_INCIDENT_TOKEN=incident-secret \\',
      '  GATEWAY_TEMPLATE_TOKEN=tmpl-secret \\',
      '    node scripts/e2e-integrity-incident-smoke.js',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function fail(step, message) {
  throw new Error(`[${step}] ${message}`)
}

function checkpoint(status, step, message) {
  console.log(`[${status}] ${step}: ${message}`)
}

function parseArgs(argv) {
  const args = {
    baseUrl: '',
    stateToken: '',
    incidentToken: '',
    templateToken: '',
    timeoutMs: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) fail('args', `missing value for ${arg}`)
      i += 1
      return next
    }

    switch (arg) {
      case '--base-url':
        args.baseUrl = readValue()
        break
      case '--state-token':
        args.stateToken = readValue()
        break
      case '--incident-token':
        args.incidentToken = readValue()
        break
      case '--template-token':
        args.templateToken = readValue()
        break
      case '--timeout-ms':
        args.timeoutMs = readValue()
        break
      default:
        if (arg.startsWith('--')) fail('args', `unknown option: ${arg}`)
        fail('args', `unexpected positional argument: ${arg}`)
    }
  }

  return args
}

function resolveUrl(baseUrl, path) {
  if (!baseUrl) fail('config', 'missing base url')
  try {
    return new URL(path, baseUrl).toString()
  } catch (_) {
    fail('config', `invalid base url: ${baseUrl}`)
  }
}

function readEnv(name) {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function resolveConfig(args) {
  const baseUrl = (args.baseUrl || readEnv('GATEWAY_BASE_URL')).trim()
  if (!baseUrl) fail('config', 'set GATEWAY_BASE_URL or pass --base-url')

  let timeoutMs = Number.parseInt(args.timeoutMs || readEnv('GATEWAY_SMOKE_TIMEOUT_MS') || `${DEFAULT_TIMEOUT_MS}`, 10)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = DEFAULT_TIMEOUT_MS

  return {
    baseUrl,
    timeoutMs,
    stateToken: (args.stateToken || readEnv('GATEWAY_INTEGRITY_STATE_TOKEN')).trim(),
    incidentToken: (args.incidentToken || readEnv('GATEWAY_INTEGRITY_INCIDENT_TOKEN')).trim(),
    templateToken: (args.templateToken || readEnv('GATEWAY_TEMPLATE_TOKEN')).trim(),
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function requestJson(url, init, timeoutMs) {
  const res = await fetchWithTimeout(url, init, timeoutMs)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (_) {
    json = null
  }
  return { res, text, json }
}

function buildStateHeaders(token) {
  const headers = { accept: 'application/json' }
  if (token) {
    headers.authorization = `Bearer ${token}`
    headers['x-integrity-token'] = token
  }
  return headers
}

function buildIncidentHeaders(token) {
  const headers = { accept: 'application/json', 'content-type': 'application/json' }
  if (token) {
    headers.authorization = `Bearer ${token}`
    headers['x-incident-token'] = token
  }
  return headers
}

function buildTemplateHeaders(token) {
  const headers = { accept: 'application/json', 'content-type': 'application/json' }
  if (token) headers['x-template-token'] = token
  return headers
}

async function readState(config, label) {
  const url = resolveUrl(config.baseUrl, STATE_URL_PATH)
  const { res, text, json } = await requestJson(
    url,
    {
      method: 'GET',
      headers: buildStateHeaders(config.stateToken),
    },
    config.timeoutMs,
  )

  if (res.status !== 200) {
    fail(label, `expected 200 from ${STATE_URL_PATH}, got ${res.status}: ${text.slice(0, 500)}`)
  }
  if (!json || typeof json !== 'object' || !json.policy || typeof json.policy.paused !== 'boolean') {
    fail(label, `unexpected state payload: ${text.slice(0, 500)}`)
  }

  checkpoint('PASS', label, `paused=${json.policy.paused} source=${json.policy.source || 'unknown'}`)
  return json
}

async function sendIncident(config, action, label) {
  const url = resolveUrl(config.baseUrl, INCIDENT_URL_PATH)
  const body =
    action === 'pause'
      ? { action, event: 'manual-freeze', source: 'smoke', severity: 'critical' }
      : { action, event: 'manual-unfreeze', source: 'smoke', severity: 'high' }

  const { res, text, json } = await requestJson(
    url,
    {
      method: 'POST',
      headers: buildIncidentHeaders(config.incidentToken),
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  )

  if (res.status !== 200) {
    fail(label, `expected 200 from ${INCIDENT_URL_PATH}, got ${res.status}: ${text.slice(0, 500)}`)
  }
  if (!json || typeof json !== 'object' || json.ok !== true) {
    fail(label, `unexpected incident response: ${text.slice(0, 500)}`)
  }
  if (json.action !== action) {
    fail(label, `expected action=${action}, got ${String(json.action)}`)
  }

  checkpoint('PASS', label, `incidentId=${json.incidentId || 'n/a'} paused=${json.paused}`)
  return json
}

async function callPausedTemplate(config) {
  const url = resolveUrl(config.baseUrl, TEMPLATE_URL_PATH)
  const body = {
    action: WRITE_ACTION,
    payload: WRITE_PAYLOAD,
  }

  const { res, text, json } = await requestJson(
    url,
    {
      method: 'POST',
      headers: buildTemplateHeaders(config.templateToken),
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  )

  if (res.status !== 503) {
    fail('template-call', `expected 503 while paused, got ${res.status}: ${text.slice(0, 500)}`)
  }
  if (!json || typeof json !== 'object') {
    fail('template-call', `expected JSON paused envelope, got: ${text.slice(0, 500)}`)
  }
  const expected = {
    error: 'policy_paused',
    reason: 'integrity_policy_paused',
    paused: true,
    retryable: false,
  }
  const payload = json
  for (const [key, value] of Object.entries(expected)) {
    if (!payload || typeof payload !== 'object' || payload[key] !== value) {
      fail('template-call', `expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(payload ? payload[key] : undefined)}`)
    }
  }

  checkpoint('PASS', 'template-call', `blocked write action=${WRITE_ACTION}`)
}

async function restoreState(config, desiredPaused) {
  if (desiredPaused) {
    await sendIncident(config, 'pause', 'restore')
  } else {
    await sendIncident(config, 'resume', 'restore')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = resolveConfig(args)

  checkpoint('INFO', 'config', `base-url=${config.baseUrl} timeout-ms=${config.timeoutMs}`)

  let originalPaused = null
  let currentPaused = null
  let restoreNeeded = false

  try {
    const initialState = await readState(config, 'state-before')
    originalPaused = initialState.policy.paused
    currentPaused = originalPaused

    const pause = await sendIncident(config, 'pause', 'pause')
    currentPaused = pause.paused
    restoreNeeded = currentPaused !== originalPaused

    if (currentPaused !== true) {
      fail('pause', 'pause action did not leave the gateway paused')
    }

    await callPausedTemplate(config)

    const resume = await sendIncident(config, 'resume', 'resume')
    currentPaused = resume.paused
    restoreNeeded = currentPaused !== originalPaused

    if (currentPaused !== false) {
      fail('resume', 'resume action did not leave the gateway unpaused')
    }

    const finalState = await readState(config, 'state-after')
    currentPaused = finalState.policy.paused
    restoreNeeded = currentPaused !== originalPaused

    if (finalState.policy.paused !== false) {
      fail('state-after', `expected paused=false after resume, got ${finalState.policy.paused}`)
    }

    checkpoint('PASS', 'flow', 'incident control smoke completed')
  } catch (err) {
    checkpoint('FAIL', 'flow', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  } finally {
    if (originalPaused !== null && restoreNeeded) {
      try {
        await restoreState(config, originalPaused)
        checkpoint('PASS', 'cleanup', `restored original paused=${originalPaused}`)
      } catch (err) {
        checkpoint('FAIL', 'cleanup', err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      }
    }
  }
}

main().catch((err) => {
  checkpoint('FAIL', 'fatal', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
