#!/usr/bin/env node

import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'

const REQUIRED_FILES = ['compare.txt', 'attestation.json', 'manifest.json']

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-attestation-exchange-pack.js --bundle <DIR> [--bundle <DIR> ...] --out <FILE> [--include-compare-log]',
      '',
      'Options:',
      '  --bundle <DIR>           Evidence bundle directory to include (repeatable, required)',
      '  --out <FILE>             Destination JSON file for the exchange pack (required)',
      '  --include-compare-log    Include a short compare log snippet for each bundle',
      '  --help                   Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   validation/data error',
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

function isSha256Digest(value) {
  return isNonEmptyString(value) && /^sha256:[0-9a-f]{64}$/.test(value)
}

function parseArgs(argv) {
  const args = {
    bundles: [],
    out: '',
    includeCompareLog: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`, 64)
      i += 1
      return next
    }

    switch (arg) {
      case '--bundle':
        args.bundles.push(readValue())
        break
      case '--out':
        args.out = readValue()
        break
      case '--include-compare-log':
        args.includeCompareLog = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (args.bundles.length === 0) die('--bundle is required at least once', 64)
  if (!isNonEmptyString(args.out)) die('--out is required', 64)
  for (const bundle of args.bundles) {
    if (!isNonEmptyString(bundle)) die('--bundle values must not be blank', 64)
  }

  return args
}

function makeCompareSnippet(text) {
  const trimmed = text.trim()
  if (!trimmed) return ''

  const lines = trimmed.split(/\r?\n/)
  const slice = lines.slice(0, 8).join('\n')
  if (slice.length <= 600) return slice
  return `${slice.slice(0, 600).trimEnd()}…`
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`malformed JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function validateManifest(manifest, path) {
  if (!isObject(manifest)) die(`manifest.json in ${path} must be a JSON object`)

  for (const key of ['status', 'urls', 'compare', 'attestation']) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) {
      die(`manifest.json in ${path} is missing required key: ${key}`)
    }
  }

  if (!isNonEmptyString(manifest.status)) die(`manifest.status in ${path} must be a non-empty string`)
  if (!Array.isArray(manifest.urls) || manifest.urls.length === 0) {
    die(`manifest.urls in ${path} must be a non-empty array`)
  }
  for (let i = 0; i < manifest.urls.length; i += 1) {
    if (!isNonEmptyString(manifest.urls[i])) {
      die(`manifest.urls[${i}] in ${path} must be a non-empty string`)
    }
  }

  if (!isObject(manifest.compare)) die(`manifest.compare in ${path} must be an object`)
  if (!isObject(manifest.attestation)) die(`manifest.attestation in ${path} must be an object`)
  if (!Number.isInteger(manifest.compare.exitCode)) die(`manifest.compare.exitCode in ${path} must be an integer`)
  if (!Number.isInteger(manifest.attestation.exitCode)) {
    die(`manifest.attestation.exitCode in ${path} must be an integer`)
  }

  const expectedDigest =
    (isSha256Digest(manifest.attestation.digest) && manifest.attestation.digest) ||
    (isSha256Digest(manifest.attestationDigest) && manifest.attestationDigest) ||
    (isSha256Digest(manifest.digest) && manifest.digest) ||
    ''

  return {
    status: manifest.status,
    urls: manifest.urls.slice(),
    compare: {
      exitCode: manifest.compare.exitCode,
      ok: manifest.compare.ok === true,
    },
    attestation: {
      exitCode: manifest.attestation.exitCode,
      ok: manifest.attestation.ok === true,
    },
    expectedDigest,
    tool: isNonEmptyString(manifest.tool) ? manifest.tool : '',
    version: typeof manifest.version === 'number' || typeof manifest.version === 'string' ? manifest.version : '',
    startedAt: isNonEmptyString(manifest.startedAt) ? manifest.startedAt : '',
    finishedAt: isNonEmptyString(manifest.finishedAt) ? manifest.finishedAt : '',
  }
}

function validateAttestation(attestation, path) {
  if (!isObject(attestation)) die(`attestation.json in ${path} must be a JSON object`)
  if (!isSha256Digest(attestation.digest)) die(`attestation.json in ${path} must include a valid sha256 digest`)
  return attestation.digest
}

async function buildBundleRecord(bundleInput, includeCompareLog) {
  const bundleDir = resolve(bundleInput)

  let bundleStat
  try {
    bundleStat = await stat(bundleDir)
  } catch (err) {
    die(`unable to access bundle directory ${bundleDir}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!bundleStat.isDirectory()) die(`not a directory: ${bundleDir}`)

  const missing = []
  for (const file of REQUIRED_FILES) {
    try {
      await readFile(join(bundleDir, file), 'utf8')
    } catch (_) {
      missing.push(file)
    }
  }
  if (missing.length > 0) die(`missing required file(s) in ${bundleDir}: ${missing.join(', ')}`)

  const manifestPath = join(bundleDir, 'manifest.json')
  const attestationPath = join(bundleDir, 'attestation.json')
  const comparePath = join(bundleDir, 'compare.txt')

  const manifest = await readJson(manifestPath)
  const attestation = await readJson(attestationPath)
  const manifestMetadata = validateManifest(manifest, manifestPath)
  const attestationDigest = validateAttestation(attestation, attestationPath)

  let compareSummarySnippet
  if (includeCompareLog) {
    const compareText = await readFile(comparePath, 'utf8')
    compareSummarySnippet = makeCompareSnippet(compareText)
  }

  return {
    bundleDir,
    comparePath,
    attestationPath,
    manifestPath,
    manifestMetadata,
    attestationDigest,
    compareSummarySnippet,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const bundles = []
  for (const bundleInput of args.bundles) {
    bundles.push(await buildBundleRecord(bundleInput, args.includeCompareLog))
  }

  const referenceDigest = bundles[0] ? bundles[0].attestationDigest : ''
  let mismatchedDigest = 0
  let ok = 0
  for (const bundle of bundles) {
    const expectedDigest = bundle.manifestMetadata.expectedDigest || referenceDigest
    const digestMatches = !expectedDigest || bundle.attestationDigest === expectedDigest
    const bundleOk =
      bundle.manifestMetadata.status === 'ok' &&
      bundle.manifestMetadata.compare.exitCode === 0 &&
      bundle.manifestMetadata.attestation.exitCode === 0 &&
      digestMatches

    if (bundleOk) ok += 1
    if (!digestMatches) mismatchedDigest += 1
  }

  const output = {
    createdAt: new Date().toISOString(),
    bundles,
    summary: {
      total: bundles.length,
      ok,
      failed: bundles.length - ok,
      mismatchedDigest,
      referenceDigest,
    },
  }

  const outPath = resolve(args.out)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${outPath}\n`)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
