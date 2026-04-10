#!/usr/bin/env node

import { createHash, createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const SCRIPT_VERSION_TAG = 'integrity-attestation-v1'
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

function getField(snapshot, path) {
  let current = snapshot
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return { found: false }
    current = current[key]
  }
  return { found: true, value: current }
}

function compareSnapshots(results) {
  const comparedFields = []
  let mismatchCount = 0
  let invalidFieldCount = 0

  for (const [field, path] of COMPARED_FIELDS) {
    const values = results.map((result) => {
      const entry = getField(result.snapshot, path)
      return {
        gateway: result.label,
        url: result.url,
        found: entry.found,
        value: entry.found ? entry.value : null,
      }
    })

    if (values.some((entry) => !entry.found)) {
      invalidFieldCount += 1
      comparedFields.push({
        field,
        status: 'invalid',
        values,
      })
      continue
    }

    const consensus = values.every((entry) => deepEqual(entry.value, values[0].value))
    if (!consensus) mismatchCount += 1
    comparedFields.push({
      field,
      status: consensus ? 'consensus' : 'mismatch',
      values,
    })
  }

  return { comparedFields, mismatchCount, invalidFieldCount }
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry))
  const out = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (typeof entry !== 'undefined') {
      out[key] = canonicalize(entry)
    }
  }
  return out
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex')
}

function signHmac(secret, text) {
  return createHmac('sha256', secret).update(text).digest('hex')
}

function buildArtifact(results, comparison) {
  const generatedAt = new Date().toISOString()
  const canonicalSegment = {
    artifactType: 'gateway-integrity-attestation',
    scriptVersionTag: SCRIPT_VERSION_TAG,
    generatedAt,
    gateways: results.map((result) => ({
      label: result.label,
      url: result.url,
      snapshot: result.snapshot,
    })),
    comparedFields: comparison.comparedFields,
    summary: {
      mismatchCount: comparison.mismatchCount,
      invalidFieldCount: comparison.invalidFieldCount,
      gatewayCount: results.length,
    },
  }

  const canonicalText = canonicalJson(canonicalSegment)
  const artifact = {
    ...canonicalSegment,
    digest: `sha256:${sha256Hex(canonicalText)}`,
  }

  return { artifact, canonicalText }
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

  const comparison = compareSnapshots(results)
  const { artifact, canonicalText } = buildArtifact(results, comparison)

  const hmacEnvName = args.hmacEnv || ''
  const hmacSecret = hmacEnvName ? process.env[hmacEnvName] || '' : ''
  if (hmacEnvName && hmacSecret.trim()) {
    artifact.hmacEnv = hmacEnvName
    artifact.hmacSha256 = `sha256:${signHmac(hmacSecret, canonicalText)}`
  }

  await writeArtifact(args.out, artifact)

  process.exit(comparison.invalidFieldCount > 0 ? 2 : comparison.mismatchCount > 0 ? 3 : 0)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
