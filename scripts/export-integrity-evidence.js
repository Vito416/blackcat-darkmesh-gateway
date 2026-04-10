#!/usr/bin/env node

import { parseGatewayUrls } from './lib/compare-integrity-state-core.js'
import { exportIntegrityEvidence, VALID_PROTOCOLS } from './lib/export-integrity-evidence-core.js'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/export-integrity-evidence.js --url <gateway-url> --url <gateway-url> --out-dir <path> [--token <VALUE> ...] [--hmac-env <ENV_NAME>]',
      '',
      'Options:',
      '  --url <URL>        Gateway base URL; repeat at least twice',
      '  --out-dir <PATH>   Base directory for the timestamped evidence bundle',
      '  --token <VALUE>    Optional auth token; repeat once per URL or once for all URLs',
      '  --hmac-env <NAME>  Optional env var name containing an HMAC key for attestation',
      '  --help             Show this help',
      '',
      'Auth token fallback:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN',
      '',
      'Examples:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \\',
      '    node scripts/export-integrity-evidence.js \\',
      '      --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '      --out-dir ./artifacts/evidence',
      '',
      '  node scripts/export-integrity-evidence.js \\',
      '    --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '    --token token-a --token token-b \\',
      '    --out-dir ./artifacts/evidence \\',
      '    --hmac-env GATEWAY_ATTESTATION_HMAC_KEY',
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
    outDir: '',
    hmacEnv: '',
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
      case '--out-dir':
        args.outDir = readValue()
        break
      case '--hmac-env':
        args.hmacEnv = readValue()
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        die(`unexpected positional argument: ${arg}`)
    }
  }

  if (args.urls.length < 2) die('at least two --url values are required')
  if (typeof args.outDir !== 'string' || !args.outDir.trim()) die('--out-dir must not be blank')
  for (const url of args.urls) {
    validateUrl(url)
  }

  for (const token of args.tokens) {
    if (typeof token !== 'string' || !token.trim()) die('--token values must not be blank')
  }
  if (args.tokens.length > 0 && args.tokens.length !== 1 && args.tokens.length !== args.urls.length) {
    die('pass either one --token for all URLs or one --token per URL')
  }

  if (args.hmacEnv && !args.hmacEnv.trim()) die('--hmac-env must not be blank')

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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const urls = parseGatewayUrls(args.urls)
  const result = await exportIntegrityEvidence({
    urls,
    args,
    envToken: process.env.GATEWAY_INTEGRITY_STATE_TOKEN || '',
  })

  if (result.exitCode !== 0) {
    console.error(`[export-integrity-evidence] bundle completed with failures in ${result.bundleDir}`)
    if (result.compareResult.status !== 0) {
      console.error(`[export-integrity-evidence] compare failed with exit code ${result.compareResult.status}`)
    }
    if (result.attestationResult.status !== 0) {
      console.error(`[export-integrity-evidence] attestation failed with exit code ${result.attestationResult.status}`)
    }
    process.exit(result.exitCode)
  }

  console.log(`[export-integrity-evidence] wrote evidence bundle to ${result.bundleDir}`)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
