#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-ao-vs-gateway-scenarios.js --ao-base <URL> --gateway-base <URL> --host <HOST> [options]',
      '',
      'Required:',
      '  --ao-base <URL>          AO public API base URL (e.g. http://127.0.0.1:8788)',
      '  --gateway-base <URL>     Gateway base URL (e.g. http://127.0.0.1:8080)',
      '  --host <HOST>            Site host used in public lookups',
      '',
      'Optional:',
      '  --site-id <ID>           Enables public.get-page scenario',
      '  --template-token <TOK>   Adds x-template-token header to gateway requests',
      '  --ao-api-token <TOK>     Adds x-api-token header to AO requests',
      '  --ao-bearer-token <TOK>  Adds Authorization: Bearer <token> to AO requests',
      '  --ao-template-token <TOK> Adds x-template-token header to AO requests',
      '  --requests <N>           Override defaults.requests (default 200)',
      '  --concurrency <N>        Override defaults.concurrency (default 20)',
      '  --warmup <N>             Override defaults.warmup (default 10)',
      '  --timeout-ms <N>         Override defaults.timeoutMs (default 5000)',
      '  --out <FILE>             Output file path (default config/bench/ao-vs-gateway.scenarios.live.json)',
      '  --help                   Show help',
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

function asUrl(value, name) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      die(`${name} must use http/https`)
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    die(`${name} must be a valid URL`)
  }
}

function parseArgs(argv) {
  const args = {
    aoBase: '',
    gatewayBase: '',
    host: '',
    siteId: '',
    templateToken: '',
    aoApiToken: '',
    aoBearerToken: '',
    aoTemplateToken: '',
    requests: 200,
    concurrency: 20,
    warmup: 10,
    timeoutMs: 5000,
    out: 'config/bench/ao-vs-gateway.scenarios.live.json',
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
      case '--ao-base':
        args.aoBase = readValue()
        break
      case '--gateway-base':
        args.gatewayBase = readValue()
        break
      case '--host':
        args.host = readValue()
        break
      case '--site-id':
        args.siteId = readValue()
        break
      case '--template-token':
        args.templateToken = readValue()
        break
      case '--ao-api-token':
        args.aoApiToken = readValue()
        break
      case '--ao-bearer-token':
        args.aoBearerToken = readValue()
        break
      case '--ao-template-token':
        args.aoTemplateToken = readValue()
        break
      case '--requests':
        args.requests = parseIntFlag(readValue(), '--requests')
        break
      case '--concurrency':
        args.concurrency = parseIntFlag(readValue(), '--concurrency')
        break
      case '--warmup':
        args.warmup = parseIntFlag(readValue(), '--warmup', 0)
        break
      case '--timeout-ms':
        args.timeoutMs = parseIntFlag(readValue(), '--timeout-ms')
        break
      case '--out':
        args.out = readValue()
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        die(`unexpected positional argument: ${arg}`)
    }
  }

  if (!args.aoBase) die('--ao-base is required')
  if (!args.gatewayBase) die('--gateway-base is required')
  if (!args.host) die('--host is required')

  args.aoBase = asUrl(args.aoBase, '--ao-base')
  args.gatewayBase = asUrl(args.gatewayBase, '--gateway-base')
  args.host = args.host.trim().toLowerCase()
  if (!args.host) die('--host cannot be blank')
  args.siteId = args.siteId.trim()
  return args
}

function buildGatewayHeaders(templateToken) {
  if (!templateToken) return undefined
  return { 'x-template-token': templateToken }
}

function buildAoHeaders(args) {
  const headers = {}
  if (args.aoApiToken) headers['x-api-token'] = args.aoApiToken
  if (args.aoBearerToken) headers.authorization = `Bearer ${args.aoBearerToken}`
  if (args.aoTemplateToken) headers['x-template-token'] = args.aoTemplateToken
  return Object.keys(headers).length > 0 ? headers : undefined
}

function buildScenarioConfig(args) {
  const gatewayHeaders = buildGatewayHeaders(args.templateToken)
  const aoHeaders = buildAoHeaders(args)
  const resolveRouteAoBody = args.siteId
    ? { host: args.host, path: '/', siteId: args.siteId }
    : { host: args.host, path: '/' }
  const resolveRouteGatewayPayload = args.siteId
    ? { host: args.host, path: '/', siteId: args.siteId }
    : { host: args.host, path: '/' }
  const scenarios = [
    {
      name: 'public-site-by-host',
      expectStatus: [200, 404],
      ao: {
        url: `${args.aoBase}/api/public/site-by-host`,
        method: 'POST',
        ...(aoHeaders ? { headers: aoHeaders } : {}),
        body: { host: args.host },
      },
      gateway: {
        url: `${args.gatewayBase}/template/call`,
        method: 'POST',
        ...(gatewayHeaders ? { headers: gatewayHeaders } : {}),
        body: {
          action: 'public.site-by-host',
          payload: { host: args.host },
        },
      },
    },
    {
      name: 'public-resolve-route',
      expectStatus: [200, 404],
      ao: {
        url: `${args.aoBase}/api/public/resolve-route`,
        method: 'POST',
        ...(aoHeaders ? { headers: aoHeaders } : {}),
        body: resolveRouteAoBody,
      },
      gateway: {
        url: `${args.gatewayBase}/template/call`,
        method: 'POST',
        ...(gatewayHeaders ? { headers: gatewayHeaders } : {}),
        body: {
          action: 'public.resolve-route',
          payload: resolveRouteGatewayPayload,
        },
      },
    },
  ]

  if (args.siteId) {
    scenarios.push({
      name: 'public-get-page',
      expectStatus: [200, 404],
      ao: {
        url: `${args.aoBase}/api/public/page`,
        method: 'POST',
        ...(aoHeaders ? { headers: aoHeaders } : {}),
        body: { siteId: args.siteId, slug: '/' },
      },
      gateway: {
        url: `${args.gatewayBase}/template/call`,
        method: 'POST',
        ...(gatewayHeaders ? { headers: gatewayHeaders } : {}),
        body: {
          action: 'public.get-page',
          payload: { siteId: args.siteId, slug: '/' },
        },
      },
    })
  }

  return {
    defaults: {
      requests: args.requests,
      concurrency: args.concurrency,
      warmup: args.warmup,
      timeoutMs: args.timeoutMs,
    },
    scenarios,
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const output = resolve(args.out)
  const config = buildScenarioConfig(args)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.log(output)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exit(1)
})
