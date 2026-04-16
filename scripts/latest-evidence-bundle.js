#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const REQUIRED_FILES = ['compare.txt', 'attestation.json', 'manifest.json']
const TIMESTAMPED_DIR_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(?:-.+)?$/

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/latest-evidence-bundle.js --root <dir> [--json] [--require-files]',
      '',
      'Options:',
      '  --root <DIR>        Root directory that contains timestamped evidence bundles (required)',
      '  --json              Print JSON output instead of human-readable text',
      '  --require-files     Fail if compare.txt, attestation.json, or manifest.json are missing',
      '  --help              Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   no matching bundle found or required files missing',
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

function parseTimestampedDirName(name) {
  const match = TIMESTAMPED_DIR_RE.exec(name)
  if (!match) return null

  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`
  const timestampMs = Date.parse(iso)
  if (!Number.isFinite(timestampMs)) return null

  return {
    iso,
    timestampMs,
  }
}

function compareCandidates(a, b) {
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs
  if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs
  return a.name.localeCompare(b.name)
}

function formatResult(result, asJson) {
  if (asJson) {
    return `${JSON.stringify(result, null, 2)}\n`
  }

  const lines = [
    `bundleDir: ${result.bundleDir}`,
    `comparePath: ${result.comparePath}`,
    `attestationPath: ${result.attestationPath}`,
    `manifestPath: ${result.manifestPath}`,
  ]

  if (result.missingFiles.length > 0) {
    lines.push(`missingFiles: ${result.missingFiles.join(', ')}`)
  }

  return `${lines.join('\n')}\n`
}

function parseArgs(argv) {
  const args = {
    root: '',
    json: false,
    requireFiles: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    switch (arg) {
      case '--root': {
        const next = argv[i + 1]
        if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --root', 64)
        args.root = next
        i += 1
        break
      }
      case '--json':
        args.json = true
        break
      case '--require-files':
        args.requireFiles = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.root)) die('--root is required', 64)
  return args
}

async function findLatestTimestampedBundle(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const candidates = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseTimestampedDirName(entry.name)
    if (!parsed) continue

    const fullPath = join(root, entry.name)
    const info = await stat(fullPath)
    candidates.push({
      name: entry.name,
      bundleDir: fullPath,
      timestampMs: parsed.timestampMs,
      mtimeMs: info.mtimeMs,
    })
  }

  if (candidates.length === 0) return null

  return candidates.reduce((best, current) => (compareCandidates(current, best) > 0 ? current : best))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root)

  let rootStat
  try {
    rootStat = await stat(root)
  } catch (err) {
    die(`unable to read root directory: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!rootStat.isDirectory()) die(`root is not a directory: ${root}`)

  let latest
  try {
    latest = await findLatestTimestampedBundle(root)
  } catch (err) {
    die(`unable to scan root directory: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!latest) {
    die(`no timestamped evidence bundle found in ${root}`)
  }

  const result = {
    root,
    selectedDirName: latest.name,
    bundleDir: latest.bundleDir,
    comparePath: join(latest.bundleDir, 'compare.txt'),
    attestationPath: join(latest.bundleDir, 'attestation.json'),
    manifestPath: join(latest.bundleDir, 'manifest.json'),
    missingFiles: [],
  }

  for (const file of REQUIRED_FILES) {
    try {
      await readFile(join(latest.bundleDir, file), 'utf8')
    } catch (_) {
      result.missingFiles.push(file)
    }
  }

  if (args.requireFiles && result.missingFiles.length > 0) {
    die(`missing required file(s): ${result.missingFiles.join(', ')}`)
  }

  process.stdout.write(formatResult(result, args.json))
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
