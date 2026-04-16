#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { expectedAttestationDigest } from './lib/attestation-json.js'

const REQUIRED_FILES = ['compare.txt', 'attestation.json', 'manifest.json']
const VALIDATOR_PATH = fileURLToPath(new URL('./validate-integrity-attestation.js', import.meta.url))

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/check-evidence-bundle.js --dir <bundleDir> [--strict]',
      '',
      'Options:',
      '  --dir <PATH>    Evidence bundle directory to check (required)',
      '  --strict        Require an ok manifest and zero exit codes',
      '  --help          Show this help',
      '',
      'Exit codes:',
      '  0   valid bundle',
      '  3   invalid bundle',
      '  64  usage error',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 3) {
  console.error(`invalid evidence bundle: ${message}`)
  process.exit(exitCode)
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    dir: '',
    strict: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    switch (arg) {
      case '--dir': {
        const next = argv[i + 1]
        if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --dir', 64)
        args.dir = next
        i += 1
        break
      }
      case '--strict':
        args.strict = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) die('--dir is required', 64)
  return args
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`malformed JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function runAttestationValidator(filePath) {
  const child = spawnSync(process.execPath, [VALIDATOR_PATH, '--file', filePath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  return {
    status: typeof child.status === 'number' ? child.status : child.error || child.signal ? 1 : 0,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
    error: child.error ? String(child.error.message || child.error) : '',
  }
}

function validateManifest(manifest, strict) {
  if (!isObject(manifest)) die('manifest.json must be a JSON object')

  for (const key of ['status', 'urls', 'compare', 'attestation']) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) {
      die(`manifest.json is missing required key: ${key}`)
    }
  }

  if (!isNonEmptyString(manifest.status)) die('manifest.status must be a non-empty string')
  if (!Array.isArray(manifest.urls) || manifest.urls.length === 0) die('manifest.urls must be a non-empty array')
  for (let i = 0; i < manifest.urls.length; i += 1) {
    if (!isNonEmptyString(manifest.urls[i])) die(`manifest.urls[${i}] must be a non-empty string`)
  }

  if (!isObject(manifest.compare)) die('manifest.compare must be an object')
  if (!isObject(manifest.attestation)) die('manifest.attestation must be an object')

  if (!Number.isInteger(manifest.compare.exitCode)) die('manifest.compare.exitCode must be an integer')
  if (!Number.isInteger(manifest.attestation.exitCode)) die('manifest.attestation.exitCode must be an integer')

  if (strict) {
    if (manifest.status !== 'ok') die(`manifest.status must be "ok" in strict mode (found ${manifest.status})`)
    if (manifest.compare.exitCode !== 0) die(`manifest.compare.exitCode must be 0 in strict mode (found ${manifest.compare.exitCode})`)
    if (manifest.attestation.exitCode !== 0) {
      die(`manifest.attestation.exitCode must be 0 in strict mode (found ${manifest.attestation.exitCode})`)
    }
  }
}

function validateAttestationArtifact(artifact, path) {
  if (!isObject(artifact)) die('attestation.json must be a JSON object')

  const error = (() => {
    if (artifact.artifactType !== 'gateway-integrity-attestation') return 'artifactType must be gateway-integrity-attestation'
    if (artifact.scriptVersionTag !== 'integrity-attestation-v1') return 'scriptVersionTag must be integrity-attestation-v1'
    if (!isNonEmptyString(artifact.generatedAt)) return 'generatedAt must be a non-empty string'
    if (!Array.isArray(artifact.gateways) || artifact.gateways.length < 2) return 'gateways must be an array with at least two entries'
    if (!Array.isArray(artifact.comparedFields) || artifact.comparedFields.length === 0) return 'comparedFields must be a non-empty array'
    if (!isObject(artifact.summary)) return 'summary must be an object'
    if (!isNonEmptyString(artifact.digest) || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) {
      return 'digest must be a sha256 hex digest'
    }
    if (artifact.digest !== expectedAttestationDigest(artifact)) return 'digest mismatch'
    return null
  })()

  if (error) die(`attestation.json failed local validation: ${error}`)

  const validatorResult = runAttestationValidator(path)
  if (validatorResult.status !== 0) {
    const detail = (validatorResult.stderr || validatorResult.stdout || validatorResult.error || '').trim()
    if (detail) {
      die(`attestation validator rejected bundle: ${detail}`)
    }
    die(`attestation validator exited with code ${validatorResult.status}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const bundleDir = resolve(args.dir)

  let bundleStats
  try {
    bundleStats = await stat(bundleDir)
  } catch (err) {
    die(`unable to access bundle directory: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!bundleStats.isDirectory()) {
    die(`not a directory: ${bundleDir}`)
  }

  const missing = []
  for (const file of REQUIRED_FILES) {
    try {
      await readFile(join(bundleDir, file), 'utf8')
    } catch (_) {
      missing.push(file)
    }
  }
  if (missing.length > 0) {
    die(`missing required file(s): ${missing.join(', ')}`)
  }

  let manifest
  let attestation
  try {
    manifest = await readJson(join(bundleDir, 'manifest.json'))
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
  try {
    attestation = await readJson(join(bundleDir, 'attestation.json'))
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }

  validateManifest(manifest, args.strict)
  validateAttestationArtifact(attestation, join(bundleDir, 'attestation.json'))

  console.log(`valid evidence bundle: ${bundleDir}${args.strict ? ' (strict)' : ''}`)
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err))
})
