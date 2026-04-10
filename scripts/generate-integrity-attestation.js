#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  VALID_PROTOCOLS,
  buildAttestationArtifact,
} from './lib/attestation-core.js'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/generate-integrity-attestation.js --url <gateway-url> --url <gateway-url> --out <path> [--token <VALUE> ...] [--hmac-env <ENV_NAME>]',
      '',
      'Options:',
      '  --url <URL>         Gateway base URL; repeat at least twice',
      '  --out <PATH>        Output JSON file path (required)',
      '  --token <VALUE>     Optional auth token; repeat once per URL or once for all URLs',
      '  --hmac-env <NAME>   Optional env var name containing an HMAC key to sign the artifact',
      '  --help              Show this help',
      '',
      'Auth token fallback:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN',
      '',
      'Examples:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \\',
      '    node scripts/generate-integrity-attestation.js \\',
      '      --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '      --out ./artifacts/integrity-attestation.json',
      '',
      '  node scripts/generate-integrity-attestation.js \\',
      '    --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '    --token token-a --token token-b \\',
      '    --out ./artifacts/integrity-attestation.json \\',
      '    --hmac-env GATEWAY_ATTESTATION_HMAC_KEY',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
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

function normalizePath(value, flagName) {
  if (typeof value !== 'string' || !value.trim()) die(`${flagName} must not be blank`)
  return value
}

function parseArgs(argv) {
  const args = {
    urls: [],
    tokens: [],
    out: '',
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
      case '--out':
        args.out = readValue()
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
  for (const url of args.urls) {
    validateUrl(url)
  }

  normalizePath(args.out, '--out')

  for (const token of args.tokens) {
    if (typeof token !== 'string' || !token.trim()) die('--token values must not be blank')
  }

  if (args.tokens.length > 0 && args.tokens.length !== 1 && args.tokens.length !== args.urls.length) {
    die('pass either one --token for all URLs or one --token per URL')
  }

  if (args.hmacEnv && !args.hmacEnv.trim()) die('--hmac-env must not be blank')

  return args
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

function previewText(text, limit = 280) {
  if (typeof text !== 'string') return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function formatGatewayLabel(url, index) {
  const parsed = new URL(url)
  const host = parsed.host || parsed.hostname || 'gateway'
  return `#${index + 1} ${host}`
}

async function writeArtifact(outPath, artifact) {
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(artifact)}\n`, 'utf8')
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

  const hmacEnvName = args.hmacEnv || ''
  const hmacSecret = hmacEnvName ? process.env[hmacEnvName] || '' : ''
  const { artifact } = buildAttestationArtifact({
    results,
    hmacEnvName,
    hmacSecret,
  })

  await writeArtifact(args.out, artifact)

  process.exit(
    artifact.summary.invalidFieldCount > 0 ? 2 : artifact.summary.mismatchCount > 0 ? 3 : 0,
  )
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
