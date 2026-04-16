#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 5_000
const INCIDENT_URL_PATH = '/integrity/incident'
const STATE_URL_PATH = '/integrity/state'
const TEMPLATE_URL_PATH = '/template/call'
const WRITE_ACTION = 'checkout.create-order'
const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const EXIT_CODES = {
  ok: 0,
  config: 64,
  request: 2,
  http: 3,
  timeout: 124,
  flow: 1,
}
const WRITE_PAYLOAD = {
  siteId: 'smoke-site',
  items: [{ sku: 'smoke-sku', qty: 1 }],
}

class TimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TimeoutError'
  }
}

class SmokeError extends Error {
  constructor(step, message, code) {
    super(`[${step}] ${message}`)
    this.name = 'SmokeError'
    this.step = step
    this.code = code
  }
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
      '  GATEWAY_SMOKE_TIMEOUT_MS          Request timeout in milliseconds (default 5000)',
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

function fail(step, message, code = EXIT_CODES.flow) {
  throw new SmokeError(step, message, code)
}

function checkpoint(status, step, message) {
  console.log(`[${status}] ${step}: ${message}`)
}

function readEnv(name) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) return undefined
  return process.env[name]
}

function normalizeRequiredValue(label, value) {
  if (typeof value !== 'string') fail('config', `${label} must be a non-empty string`, EXIT_CODES.config)
  const trimmed = value.trim()
  if (!trimmed) fail('config', `${label} must be a non-empty string`, EXIT_CODES.config)
  return trimmed
}

function normalizeOptionalValue(label, value) {
  if (typeof value === 'undefined') return ''
  if (typeof value !== 'string') fail('config', `${label} must be a string`, EXIT_CODES.config)
  const trimmed = value.trim()
  if (!trimmed) fail('config', `${label} must not be blank when provided`, EXIT_CODES.config)
  return trimmed
}

function parsePositiveInteger(label, value, defaultValue) {
  if (typeof value === 'undefined' || value === '') return defaultValue
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) fail('config', `${label} must be a positive integer, got ${value}`, EXIT_CODES.config)
  return parsed
}

function normalizeBaseUrl(value) {
  const candidate = normalizeRequiredValue('base url', value)
  let parsed
  try {
    parsed = new URL(candidate)
  } catch (_) {
    fail('config', `invalid base url: ${candidate}`, EXIT_CODES.config)
  }
  if (!VALID_PROTOCOLS.has(parsed.protocol)) fail('config', `base url must use http or https: ${candidate}`, EXIT_CODES.config)
  return parsed.toString()
}

function parseArgs(argv) {
  const args = {
    baseUrl: undefined,
    stateToken: undefined,
    incidentToken: undefined,
    templateToken: undefined,
    timeoutMs: undefined,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) fail('args', `missing value for ${arg}`, EXIT_CODES.config)
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
        if (arg.startsWith('--')) fail('args', `unknown option: ${arg}`, EXIT_CODES.config)
        fail('args', `unexpected positional argument: ${arg}`, EXIT_CODES.config)
    }
  }

  return args
}

function resolveUrl(baseUrl, path) {
  if (!baseUrl) fail('config', 'missing base url', EXIT_CODES.config)
  try {
    return new URL(path, baseUrl).toString()
  } catch (_) {
    fail('config', `invalid base url: ${baseUrl}`, EXIT_CODES.config)
  }
}

function resolveConfig(args) {
  const baseUrl = normalizeBaseUrl(args.baseUrl ?? readEnv('GATEWAY_BASE_URL'))
  const timeoutMs = parsePositiveInteger(
    'timeout ms',
    args.timeoutMs ?? readEnv('GATEWAY_SMOKE_TIMEOUT_MS'),
    DEFAULT_TIMEOUT_MS,
  )

  return {
    baseUrl,
    timeoutMs,
    stateToken: normalizeOptionalValue('state token', args.stateToken ?? readEnv('GATEWAY_INTEGRITY_STATE_TOKEN')),
    incidentToken: normalizeOptionalValue('incident token', args.incidentToken ?? readEnv('GATEWAY_INTEGRITY_INCIDENT_TOKEN')),
    templateToken: normalizeOptionalValue('template token', args.templateToken ?? readEnv('GATEWAY_TEMPLATE_TOKEN')),
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) throw new TimeoutError(`request timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function previewText(text, limit = 500) {
  if (typeof text !== 'string') return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

async function requestJson(step, url, init, timeoutMs) {
  let res
  try {
    res = await fetchWithTimeout(url, init, timeoutMs)
  } catch (err) {
    if (err instanceof TimeoutError) {
      fail(step, err.message, EXIT_CODES.timeout)
    }
    fail(step, `request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`, EXIT_CODES.request)
  }
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
    label,
    url,
    {
      method: 'GET',
      headers: buildStateHeaders(config.stateToken),
    },
    config.timeoutMs,
  )

  if (res.status !== 200) {
    fail(label, `expected 200 from ${STATE_URL_PATH}, got ${res.status}: ${previewText(text)}`, EXIT_CODES.http)
  }
  if (!json || typeof json !== 'object' || !json.policy || typeof json.policy.paused !== 'boolean') {
    fail(label, `unexpected state payload: ${previewText(text)}`, EXIT_CODES.http)
  }

  checkpoint('PASS', label, `paused=${json.policy.paused} source=${json.policy.source || 'unknown'}`)
  return json
}

async function sendIncident(config, action, label) {
  if (action !== 'pause' && action !== 'resume') {
    fail('config', `unsupported incident action: ${action}`, EXIT_CODES.config)
  }
  const url = resolveUrl(config.baseUrl, INCIDENT_URL_PATH)
  const body =
    action === 'pause'
      ? { action, event: 'manual-freeze', source: 'smoke', severity: 'critical' }
      : { action, event: 'manual-unfreeze', source: 'smoke', severity: 'high' }

  const { res, text, json } = await requestJson(
    label,
    url,
    {
      method: 'POST',
      headers: buildIncidentHeaders(config.incidentToken),
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  )

  if (res.status !== 200) {
    fail(label, `expected 200 from ${INCIDENT_URL_PATH}, got ${res.status}: ${previewText(text)}`, EXIT_CODES.http)
  }
  if (!json || typeof json !== 'object' || json.ok !== true) {
    fail(label, `unexpected incident response: ${previewText(text)}`, EXIT_CODES.http)
  }
  if (json.action !== action) {
    fail(label, `expected action=${action}, got ${String(json.action)}`, EXIT_CODES.http)
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
    'template-call',
    url,
    {
      method: 'POST',
      headers: buildTemplateHeaders(config.templateToken),
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  )

  if (res.status !== 503) {
    fail('template-call', `expected 503 while paused, got ${res.status}: ${previewText(text)}`, EXIT_CODES.http)
  }
  if (!json || typeof json !== 'object') {
    fail('template-call', `expected JSON paused envelope, got: ${previewText(text)}`, EXIT_CODES.http)
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
      fail('template-call', `expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(payload ? payload[key] : undefined)}`, EXIT_CODES.http)
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
  let exitCode = EXIT_CODES.ok
  let failureStep = 'flow'
  let failureMessage = 'incident control smoke completed'

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
    failureStep = err instanceof SmokeError ? err.step : 'flow'
    failureMessage = err instanceof Error ? err.message : String(err)
    if (err instanceof SmokeError && typeof err.code === 'number') {
      exitCode = err.code
    } else if (err instanceof TimeoutError) {
      exitCode = EXIT_CODES.timeout
    } else {
      exitCode = EXIT_CODES.flow
    }
    checkpoint('FAIL', 'flow', failureMessage)
  } finally {
    if (originalPaused !== null && restoreNeeded) {
      try {
        await restoreState(config, originalPaused)
        checkpoint('PASS', 'cleanup', `restored original paused=${originalPaused}`)
      } catch (err) {
        checkpoint('FAIL', 'cleanup', err instanceof Error ? err.message : String(err))
        exitCode = exitCode === EXIT_CODES.ok ? EXIT_CODES.flow : exitCode
      }
    }
  }

  const finalStatus = exitCode === EXIT_CODES.ok ? 'PASS' : 'FAIL'
  const finalSuffix = exitCode === EXIT_CODES.ok ? 'incident control smoke completed' : `step=${failureStep} code=${exitCode}`
  console.log(`[SMOKE] ${finalStatus} ${finalSuffix}`)

  return exitCode
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((err) => {
    checkpoint('FAIL', 'fatal', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
