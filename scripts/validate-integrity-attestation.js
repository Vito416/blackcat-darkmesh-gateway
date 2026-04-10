#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/validate-integrity-attestation.js --file <path>',
      '',
      'Options:',
      '  --file <PATH>   Attestation JSON file to validate (required)',
      '  --help          Show this help',
      '',
      'Exit codes:',
      '  0   valid attestation',
      '  3   invalid attestation',
      '  64  usage error',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (_) {
    return false
  }
}

function isIsoDateTime(value) {
  if (!isNonEmptyString(value)) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
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

function expectedDigest(artifact) {
  const segment = {
    artifactType: artifact.artifactType,
    scriptVersionTag: artifact.scriptVersionTag,
    generatedAt: artifact.generatedAt,
    gateways: artifact.gateways,
    comparedFields: artifact.comparedFields,
    summary: artifact.summary,
  }
  return `sha256:${sha256Hex(canonicalJson(segment))}`
}

function validateArtifact(artifact) {
  if (!isObject(artifact)) return 'attestation must be a JSON object'

  if (artifact.artifactType !== 'gateway-integrity-attestation') {
    return 'artifactType must be gateway-integrity-attestation'
  }

  if (artifact.scriptVersionTag !== 'integrity-attestation-v1') {
    return 'scriptVersionTag must be integrity-attestation-v1'
  }

  if (!isIsoDateTime(artifact.generatedAt)) {
    return 'generatedAt must be an ISO-8601 timestamp'
  }

  if (!Array.isArray(artifact.gateways) || artifact.gateways.length < 2) {
    return 'gateways must be an array with at least two entries'
  }

  for (let i = 0; i < artifact.gateways.length; i += 1) {
    const gateway = artifact.gateways[i]
    if (!isObject(gateway)) return `gateways[${i}] must be an object`
    if (!isNonEmptyString(gateway.label)) return `gateways[${i}].label must be a non-empty string`
    if (!isHttpUrl(gateway.url)) return `gateways[${i}].url must be an http(s) URL`
    if (!isObject(gateway.snapshot)) return `gateways[${i}].snapshot must be an object`
  }

  if (!Array.isArray(artifact.comparedFields) || artifact.comparedFields.length === 0) {
    return 'comparedFields must be a non-empty array'
  }

  let mismatchCount = 0
  let invalidFieldCount = 0
  for (let i = 0; i < artifact.comparedFields.length; i += 1) {
    const entry = artifact.comparedFields[i]
    if (!isObject(entry)) return `comparedFields[${i}] must be an object`
    if (!isNonEmptyString(entry.field)) return `comparedFields[${i}].field must be a non-empty string`
    if (!['consensus', 'mismatch', 'invalid'].includes(entry.status)) {
      return `comparedFields[${i}].status must be consensus, mismatch, or invalid`
    }
    if (!Array.isArray(entry.values) || entry.values.length === 0) {
      return `comparedFields[${i}].values must be a non-empty array`
    }

    if (entry.status === 'mismatch') mismatchCount += 1
    if (entry.status === 'invalid') invalidFieldCount += 1

    for (let j = 0; j < entry.values.length; j += 1) {
      const value = entry.values[j]
      if (!isObject(value)) return `comparedFields[${i}].values[${j}] must be an object`
      if (!isNonEmptyString(value.gateway)) return `comparedFields[${i}].values[${j}].gateway must be a non-empty string`
      if (!isHttpUrl(value.url)) return `comparedFields[${i}].values[${j}].url must be an http(s) URL`
      if (typeof value.found !== 'boolean') return `comparedFields[${i}].values[${j}].found must be a boolean`
      if (!Object.prototype.hasOwnProperty.call(value, 'value')) {
        return `comparedFields[${i}].values[${j}].value must be present`
      }
    }
  }

  if (!isObject(artifact.summary)) return 'summary must be an object'
  if (!Number.isInteger(artifact.summary.mismatchCount) || artifact.summary.mismatchCount < 0) {
    return 'summary.mismatchCount must be a non-negative integer'
  }
  if (!Number.isInteger(artifact.summary.invalidFieldCount) || artifact.summary.invalidFieldCount < 0) {
    return 'summary.invalidFieldCount must be a non-negative integer'
  }
  if (!Number.isInteger(artifact.summary.gatewayCount) || artifact.summary.gatewayCount < 2) {
    return 'summary.gatewayCount must be an integer greater than or equal to 2'
  }

  if (artifact.summary.gatewayCount !== artifact.gateways.length) {
    return 'summary.gatewayCount must match gateways length'
  }
  if (artifact.summary.mismatchCount !== mismatchCount) {
    return 'summary.mismatchCount must match comparedFields status counts'
  }
  if (artifact.summary.invalidFieldCount !== invalidFieldCount) {
    return 'summary.invalidFieldCount must match comparedFields status counts'
  }

  if (!isNonEmptyString(artifact.digest) || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) {
    return 'digest must be a sha256 hex digest'
  }

  const digest = expectedDigest(artifact)
  if (artifact.digest !== digest) {
    return 'digest mismatch'
  }

  if (Object.prototype.hasOwnProperty.call(artifact, 'hmacEnv') || Object.prototype.hasOwnProperty.call(artifact, 'hmacSha256')) {
    if (!isNonEmptyString(artifact.hmacEnv)) return 'hmacEnv must be a non-empty string when hmacSha256 is present'
    if (!/^sha256:[0-9a-f]{64}$/.test(artifact.hmacSha256 || '')) {
      return 'hmacSha256 must be a sha256 hex digest when present'
    }
  }

  return null
}

async function main() {
  const argv = process.argv.slice(2)
  let filePath = ''

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--file') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --file')
      filePath = next
      i += 1
      continue
    }
    if (arg.startsWith('--')) die(`unknown option: ${arg}`)
    die(`unexpected positional argument: ${arg}`)
  }

  if (!isNonEmptyString(filePath)) {
    die('--file is required')
  }

  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    die(`unable to read file: ${err instanceof Error ? err.message : String(err)}`, 64)
  }

  let artifact
  try {
    artifact = JSON.parse(text)
  } catch (err) {
    console.error(`invalid attestation: malformed JSON (${err instanceof Error ? err.message : String(err)})`)
    process.exit(3)
  }

  const error = validateArtifact(artifact)
  if (error) {
    console.error(`invalid attestation: ${error}`)
    process.exit(3)
  }

  console.log(`valid attestation: ${filePath}`)
  process.exit(0)
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err))
})
