#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const DEFAULTS = {
  requests: 200,
  concurrency: 20,
  warmup: 10,
  timeoutMs: 5000,
  strictStatus: false,
}

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/benchmark-ao-vs-gateway.js --scenarios <FILE> [--out <FILE>] [--json] [--strict-status]',
      '',
      'Options:',
      '  --scenarios <FILE>   Required JSON scenario file',
      '  --out <FILE>         Optional output JSON report path',
      '  --json               Print final report as JSON to stdout',
      '  --strict-status      Count only expected HTTP statuses as successful samples',
      '  --help               Show this help',
      '',
      'Scenario file:',
      '  {',
      '    "defaults": { "requests": 200, "concurrency": 20, "warmup": 10, "timeoutMs": 5000 },',
      '    "scenarios": [',
      '      {',
      '        "name": "public-site-by-host",',
      '        "ao": { "url": "http://127.0.0.1:8788/api/public/site-by-host", "method": "POST", "body": { "host": "example.com" } },',
      '        "gateway": { "url": "http://127.0.0.1:8080/template/call", "method": "POST", "body": { "action": "public.site-by-host", "payload": { "host": "example.com" } } },',
      '        "expectStatus": [200]',
      '      }',
      '    ]',
      '  }',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function parseIntFlag(value, name, min = 1) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    die(`${name} must be an integer`)
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < min) die(`${name} must be >= ${min}`)
  return parsed
}

function parseArgs(argv) {
  const args = {
    scenariosPath: '',
    outPath: '',
    json: false,
    strictStatus: false,
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
      case '--scenarios':
        args.scenariosPath = readValue()
        break
      case '--out':
        args.outPath = readValue()
        break
      case '--json':
        args.json = true
        break
      case '--strict-status':
        args.strictStatus = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        die(`unexpected positional argument: ${arg}`)
    }
  }

  if (!args.scenariosPath) die('--scenarios is required')
  return args
}

async function readJsonFile(path) {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    die(`failed to read/parse JSON file ${path}: ${message}`, 3)
  }
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1))
  return sortedValues[index]
}

function summarizeSamples(samples, elapsedMs) {
  const sorted = samples.slice().sort((a, b) => a - b)
  const total = sorted.length
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    count: total,
    minMs: total > 0 ? Number(sorted[0].toFixed(3)) : null,
    maxMs: total > 0 ? Number(sorted[total - 1].toFixed(3)) : null,
    meanMs: total > 0 ? Number((sum / total).toFixed(3)) : null,
    p50Ms: total > 0 ? Number(percentile(sorted, 50).toFixed(3)) : null,
    p90Ms: total > 0 ? Number(percentile(sorted, 90).toFixed(3)) : null,
    p95Ms: total > 0 ? Number(percentile(sorted, 95).toFixed(3)) : null,
    p99Ms: total > 0 ? Number(percentile(sorted, 99).toFixed(3)) : null,
    rps: elapsedMs > 0 ? Number(((total * 1000) / elapsedMs).toFixed(3)) : null,
  }
}

function normalizeExpectStatus(input) {
  if (typeof input === 'undefined') return [200]
  if (!Array.isArray(input) || input.length === 0) die('expectStatus must be a non-empty array when provided', 64)
  const statuses = input.map((value) => parseIntFlag(String(value), 'expectStatus value', 100))
  return [...new Set(statuses)]
}

function normalizeRequestSpec(spec, name) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) die(`${name} request spec must be an object`, 64)
  const url = typeof spec.url === 'string' ? spec.url.trim() : ''
  if (!url) die(`${name} url is required`, 64)
  const method = typeof spec.method === 'string' ? spec.method.trim().toUpperCase() : 'GET'
  if (!method) die(`${name} method cannot be blank`, 64)
  const headers =
    spec.headers && typeof spec.headers === 'object' && !Array.isArray(spec.headers)
      ? spec.headers
      : {}
  return {
    url,
    method,
    headers,
    body: spec.body,
  }
}

function normalizeScenario(rawScenario, rootDefaults) {
  if (!rawScenario || typeof rawScenario !== 'object' || Array.isArray(rawScenario)) die('scenario must be an object', 64)
  const name = typeof rawScenario.name === 'string' ? rawScenario.name.trim() : ''
  if (!name) die('scenario.name is required', 64)

  const requests =
    typeof rawScenario.requests === 'undefined'
      ? rootDefaults.requests
      : parseIntFlag(String(rawScenario.requests), `${name}.requests`)
  const concurrency =
    typeof rawScenario.concurrency === 'undefined'
      ? rootDefaults.concurrency
      : parseIntFlag(String(rawScenario.concurrency), `${name}.concurrency`)
  const warmup =
    typeof rawScenario.warmup === 'undefined' ? rootDefaults.warmup : parseIntFlag(String(rawScenario.warmup), `${name}.warmup`, 0)
  const timeoutMs =
    typeof rawScenario.timeoutMs === 'undefined'
      ? rootDefaults.timeoutMs
      : parseIntFlag(String(rawScenario.timeoutMs), `${name}.timeoutMs`)

  const expectStatus = normalizeExpectStatus(rawScenario.expectStatus)

  return {
    name,
    requests,
    concurrency,
    warmup,
    timeoutMs,
    expectStatus,
    ao: normalizeRequestSpec(rawScenario.ao, `${name}.ao`),
    gateway: normalizeRequestSpec(rawScenario.gateway, `${name}.gateway`),
  }
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    die('scenario file root must be an object', 64)
  }
  const defaults = rawConfig.defaults && typeof rawConfig.defaults === 'object' && !Array.isArray(rawConfig.defaults)
    ? rawConfig.defaults
    : {}

  const rootDefaults = {
    requests:
      typeof defaults.requests === 'undefined' ? DEFAULTS.requests : parseIntFlag(String(defaults.requests), 'defaults.requests'),
    concurrency:
      typeof defaults.concurrency === 'undefined'
        ? DEFAULTS.concurrency
        : parseIntFlag(String(defaults.concurrency), 'defaults.concurrency'),
    warmup:
      typeof defaults.warmup === 'undefined' ? DEFAULTS.warmup : parseIntFlag(String(defaults.warmup), 'defaults.warmup', 0),
    timeoutMs:
      typeof defaults.timeoutMs === 'undefined'
        ? DEFAULTS.timeoutMs
        : parseIntFlag(String(defaults.timeoutMs), 'defaults.timeoutMs'),
  }

  if (!Array.isArray(rawConfig.scenarios) || rawConfig.scenarios.length === 0) {
    die('scenario file must include a non-empty scenarios array', 64)
  }

  return {
    defaults: rootDefaults,
    scenarios: rawConfig.scenarios.map((scenario) => normalizeScenario(scenario, rootDefaults)),
  }
}

function buildRequestInit(spec) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(spec.headers || {})) {
    if (typeof value === 'undefined' || value === null) continue
    headers.set(key, String(value))
  }

  let body
  if (typeof spec.body !== 'undefined') {
    if (typeof spec.body === 'string') {
      body = spec.body
    } else {
      body = JSON.stringify(spec.body)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    }
  }

  return {
    method: spec.method,
    headers,
    body,
  }
}

async function runRequest(spec, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()
  try {
    const response = await fetch(spec.url, {
      ...buildRequestInit(spec),
      signal: controller.signal,
    })
    await response.arrayBuffer()
    return {
      ok: true,
      status: response.status,
      latencyMs: performance.now() - started,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: performance.now() - started,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function warmup(spec, attempts, timeoutMs) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await runRequest(spec, timeoutMs)
  }
}

async function runLoad(spec, opts) {
  const expected = new Set(opts.expectStatus)
  const successLatencies = []
  const failureSamples = []

  let nextIndex = 0
  const started = performance.now()
  const workers = Array.from({ length: opts.concurrency }, async () => {
    while (true) {
      const idx = nextIndex
      nextIndex += 1
      if (idx >= opts.requests) return
      // eslint-disable-next-line no-await-in-loop
      const sample = await runRequest(spec, opts.timeoutMs)
      const passedStatus = sample.ok && expected.has(sample.status)
      if (!opts.strictStatus && sample.ok) {
        successLatencies.push(sample.latencyMs)
      } else if (opts.strictStatus && passedStatus) {
        successLatencies.push(sample.latencyMs)
      } else {
        failureSamples.push({
          status: sample.status,
          error: sample.ok ? `unexpected_status_${sample.status}` : sample.error || 'request_failed',
          latencyMs: Number(sample.latencyMs.toFixed(3)),
        })
      }
    }
  })
  await Promise.all(workers)
  const elapsedMs = performance.now() - started

  return {
    elapsedMs: Number(elapsedMs.toFixed(3)),
    requests: opts.requests,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    strictStatus: opts.strictStatus,
    expectStatus: [...expected],
    success: summarizeSamples(successLatencies, elapsedMs),
    failure: {
      count: failureSamples.length,
      sample: failureSamples.slice(0, 10),
    },
  }
}

function compareResults(aoResult, gatewayResult) {
  const aoP95 = aoResult.success.p95Ms
  const gwP95 = gatewayResult.success.p95Ms
  const aoRps = aoResult.success.rps
  const gwRps = gatewayResult.success.rps
  return {
    p95DeltaMs: aoP95 !== null && gwP95 !== null ? Number((gwP95 - aoP95).toFixed(3)) : null,
    p95RatioGatewayOverAo: aoP95 && gwP95 ? Number((gwP95 / aoP95).toFixed(3)) : null,
    rpsDelta: aoRps !== null && gwRps !== null ? Number((gwRps - aoRps).toFixed(3)) : null,
    rpsRatioGatewayOverAo: aoRps && gwRps ? Number((gwRps / aoRps).toFixed(3)) : null,
  }
}

function printHumanReport(report) {
  console.log(`A/B benchmark completed at ${report.generatedAt}`)
  console.log(`Scenario file: ${report.scenarioFile}`)
  console.log('')
  for (const scenario of report.scenarios) {
    console.log(`Scenario: ${scenario.name}`)
    console.log(
      `  AO      -> ok=${scenario.ao.success.count}/${scenario.ao.requests} p95=${scenario.ao.success.p95Ms ?? 'n/a'}ms rps=${scenario.ao.success.rps ?? 'n/a'} fail=${scenario.ao.failure.count}`,
    )
    console.log(
      `  Gateway -> ok=${scenario.gateway.success.count}/${scenario.gateway.requests} p95=${scenario.gateway.success.p95Ms ?? 'n/a'}ms rps=${scenario.gateway.success.rps ?? 'n/a'} fail=${scenario.gateway.failure.count}`,
    )
    console.log(
      `  Compare -> p95 delta=${scenario.compare.p95DeltaMs ?? 'n/a'}ms ratio=${scenario.compare.p95RatioGatewayOverAo ?? 'n/a'} rps ratio=${scenario.compare.rpsRatioGatewayOverAo ?? 'n/a'}`,
    )
    console.log('')
  }
}

async function writeReport(path, report) {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return absolutePath
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const rawConfig = await readJsonFile(args.scenariosPath)
  const config = normalizeConfig(rawConfig)
  const report = {
    generatedAt: new Date().toISOString(),
    scenarioFile: resolve(args.scenariosPath),
    strictStatus: args.strictStatus,
    defaults: config.defaults,
    scenarios: [],
  }

  for (const scenario of config.scenarios) {
    // eslint-disable-next-line no-await-in-loop
    await warmup(scenario.ao, scenario.warmup, scenario.timeoutMs)
    // eslint-disable-next-line no-await-in-loop
    await warmup(scenario.gateway, scenario.warmup, scenario.timeoutMs)

    // eslint-disable-next-line no-await-in-loop
    const aoResult = await runLoad(scenario.ao, {
      requests: scenario.requests,
      concurrency: scenario.concurrency,
      timeoutMs: scenario.timeoutMs,
      expectStatus: scenario.expectStatus,
      strictStatus: args.strictStatus || DEFAULTS.strictStatus,
    })
    // eslint-disable-next-line no-await-in-loop
    const gatewayResult = await runLoad(scenario.gateway, {
      requests: scenario.requests,
      concurrency: scenario.concurrency,
      timeoutMs: scenario.timeoutMs,
      expectStatus: scenario.expectStatus,
      strictStatus: args.strictStatus || DEFAULTS.strictStatus,
    })
    report.scenarios.push({
      name: scenario.name,
      requests: scenario.requests,
      concurrency: scenario.concurrency,
      warmup: scenario.warmup,
      timeoutMs: scenario.timeoutMs,
      expectStatus: scenario.expectStatus,
      ao: aoResult,
      gateway: gatewayResult,
      compare: compareResults(aoResult, gatewayResult),
    })
  }

  if (args.outPath) {
    const writtenPath = await writeReport(args.outPath, report)
    console.error(`report written: ${writtenPath}`)
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanReport(report)
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exit(1)
  })
}
