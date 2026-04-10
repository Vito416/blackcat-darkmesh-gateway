#!/usr/bin/env node

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

const REQUIRED_FILES = ['compare.txt', 'attestation.json', 'manifest.json']
const TIMESTAMPED_DIR_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(?:-.+)?$/
const OUTPUT_FIELDS = ['dir', 'timestamp', 'status', 'urlCount', 'digest', 'compareExit', 'attestationExit']

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/index-evidence-bundles.js --root <dir> [--out <file>] [--format json|csv] [--strict]',
      '',
      'Options:',
      '  --root <DIR>      Root directory that contains timestamped evidence bundles (required)',
      '  --out <FILE>      Optional output file path',
      '  --format <FMT>    Output format: json or csv (default: json)',
      '  --strict          Require compare.txt, attestation.json, and manifest.json plus valid JSON',
      '  --help            Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   strict validation failure or runtime error',
      '  64  usage error',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 3) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseTimestampedDirName(name) {
  const match = TIMESTAMPED_DIR_RE.exec(name)
  if (!match) return null

  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`
  const timestampMs = Date.parse(iso)
  if (!Number.isFinite(timestampMs)) return null

  return { iso, timestampMs }
}

function compareCandidates(a, b) {
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs
  if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs
  return a.name.localeCompare(b.name)
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

function csvCell(value) {
  if (value === null || typeof value === 'undefined') return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function formatCsv(rows) {
  const header = OUTPUT_FIELDS.join(',')
  const lines = rows.map((row) => OUTPUT_FIELDS.map((field) => csvCell(row[field])).join(','))
  return `${[header, ...lines].join('\n')}\n`
}

function formatJson(index) {
  return `${JSON.stringify(index, null, 2)}\n`
}

function parseArgs(argv) {
  const args = {
    root: '',
    out: '',
    format: 'json',
    strict: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`, 64)
      i += 1
      return next
    }

    switch (arg) {
      case '--root':
        args.root = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--format':
        args.format = readValue()
        break
      case '--strict':
        args.strict = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.root)) die('--root is required', 64)
  if (args.out && !isNonEmptyString(args.out)) die('--out must not be blank', 64)
  if (!['json', 'csv'].includes(args.format)) die('--format must be json or csv', 64)

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

function validateManifest(manifest) {
  if (!isObject(manifest)) throw new Error('manifest.json must be a JSON object')
  for (const key of ['status', 'urls', 'compare', 'attestation']) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) {
      throw new Error(`manifest.json is missing required key: ${key}`)
    }
  }
  if (typeof manifest.status !== 'string' || !manifest.status.trim()) {
    throw new Error('manifest.status must be a non-empty string')
  }
  if (!Array.isArray(manifest.urls) || manifest.urls.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error('manifest.urls must be a non-empty array of strings')
  }
  if (!isObject(manifest.compare) || !Number.isInteger(manifest.compare.exitCode)) {
    throw new Error('manifest.compare.exitCode must be an integer')
  }
  if (!isObject(manifest.attestation) || !Number.isInteger(manifest.attestation.exitCode)) {
    throw new Error('manifest.attestation.exitCode must be an integer')
  }
}

function validateAttestation(attestation) {
  if (!isObject(attestation)) throw new Error('attestation.json must be a JSON object')
  if (attestation.artifactType !== 'gateway-integrity-attestation') {
    throw new Error('artifactType must be gateway-integrity-attestation')
  }
  if (attestation.scriptVersionTag !== 'integrity-attestation-v1') {
    throw new Error('scriptVersionTag must be integrity-attestation-v1')
  }
  if (typeof attestation.generatedAt !== 'string' || !attestation.generatedAt.trim()) {
    throw new Error('generatedAt must be a non-empty string')
  }
  if (!Array.isArray(attestation.gateways) || attestation.gateways.length < 2) {
    throw new Error('gateways must be an array with at least two entries')
  }
  if (!Array.isArray(attestation.comparedFields) || attestation.comparedFields.length === 0) {
    throw new Error('comparedFields must be a non-empty array')
  }
  if (!isObject(attestation.summary)) {
    throw new Error('summary must be an object')
  }
  if (typeof attestation.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(attestation.digest)) {
    throw new Error('digest must be a sha256 hex digest')
  }
  if (attestation.digest !== expectedDigest(attestation)) {
    throw new Error('digest mismatch')
  }
}

async function loadBundleRow(bundleDir, name, strict) {
  const timestamp = parseTimestampedDirName(name)
  if (!timestamp) return null

  const row = {
    dir: bundleDir,
    timestamp: timestamp.iso,
    status: 'unknown',
    urlCount: null,
    digest: '',
    compareExit: null,
    attestationExit: null,
  }

  const requiredPaths = {
    compare: join(bundleDir, 'compare.txt'),
    attestation: join(bundleDir, 'attestation.json'),
    manifest: join(bundleDir, 'manifest.json'),
  }

  const requiredPresence = {}
  for (const [key, path] of Object.entries(requiredPaths)) {
    try {
      await readFile(path, 'utf8')
      requiredPresence[key] = true
    } catch (_) {
      requiredPresence[key] = false
    }
  }

  if (strict) {
    const missing = []
    if (!requiredPresence.compare) missing.push('compare.txt')
    if (!requiredPresence.attestation) missing.push('attestation.json')
    if (!requiredPresence.manifest) missing.push('manifest.json')
    if (missing.length > 0) {
      throw new Error(`missing required file(s): ${missing.join(', ')}`)
    }
  }

  let manifest = null
  if (requiredPresence.manifest) {
    try {
      manifest = await readJson(requiredPaths.manifest)
    } catch (err) {
      if (strict) throw err
      manifest = null
    }
    if (strict) validateManifest(manifest)
    if (manifest) {
      if (typeof manifest.status === 'string' && manifest.status.trim()) row.status = manifest.status
      if (Array.isArray(manifest.urls)) row.urlCount = manifest.urls.length
      if (isObject(manifest.compare) && Number.isInteger(manifest.compare.exitCode)) row.compareExit = manifest.compare.exitCode
      if (isObject(manifest.attestation) && Number.isInteger(manifest.attestation.exitCode)) {
        row.attestationExit = manifest.attestation.exitCode
      }
    }
  }

  if (requiredPresence.attestation) {
    let attestation
    try {
      attestation = await readJson(requiredPaths.attestation)
    } catch (err) {
      if (strict) throw err
      attestation = null
    }
    if (strict) validateAttestation(attestation)
    if (attestation && typeof attestation.digest === 'string' && attestation.digest.trim()) row.digest = attestation.digest
  }

  if (strict) {
    if (row.status === 'unknown') throw new Error('manifest.status is required in strict mode')
    if (row.urlCount === null) throw new Error('manifest.urls is required in strict mode')
    if (row.compareExit === null) throw new Error('manifest.compare.exitCode is required in strict mode')
    if (row.attestationExit === null) throw new Error('manifest.attestation.exitCode is required in strict mode')
    if (!row.digest) throw new Error('attestation.digest is required in strict mode')
  }

  return row
}

async function scanIndex(root, strict) {
  const entries = await readdir(root, { withFileTypes: true })
  const candidates = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseTimestampedDirName(entry.name)
    if (!parsed) continue

    const bundleDir = join(root, entry.name)
    const info = await stat(bundleDir)
    candidates.push({
      name: entry.name,
      bundleDir,
      timestampMs: parsed.timestampMs,
      mtimeMs: info.mtimeMs,
    })
  }

  candidates.sort(compareCandidates)

  const bundles = []
  for (const candidate of candidates) {
    const row = await loadBundleRow(candidate.bundleDir, candidate.name, strict)
    if (row) bundles.push(row)
  }

  return bundles
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root)
  const outFile = args.out ? resolve(args.out) : ''

  let rootStat
  try {
    rootStat = await stat(root)
  } catch (err) {
    die(`unable to access root directory: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!rootStat.isDirectory()) die(`root is not a directory: ${root}`)

  let bundles
  try {
    bundles = await scanIndex(root, args.strict)
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }

  const index = {
    root,
    generatedAt: new Date().toISOString(),
    format: args.format,
    bundleCount: bundles.length,
    bundles,
  }

  const output = args.format === 'csv' ? formatCsv(bundles) : formatJson(index)

  if (outFile) {
    await mkdir(dirname(outFile), { recursive: true })
    await writeFile(outFile, output, 'utf8')
  }

  process.stdout.write(output)
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err))
})
