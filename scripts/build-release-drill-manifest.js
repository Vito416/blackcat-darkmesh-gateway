#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_ARTIFACTS = [
  'consistency-matrix.json',
  'consistency-drift-report.md',
  'consistency-drift-summary.json',
  'latest-evidence-bundle.json',
  'ao-dependency-gate.validation.txt',
  'release-evidence-pack.md',
  'release-evidence-pack.json',
  'release-signoff-checklist.md',
  'release-readiness.json',
]

const DEFAULT_OUTPUT_NAME = 'release-drill-manifest.json'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-release-drill-manifest.js --dir <DRILL_DIR> [--out <FILE>] [--json] [--help]',
      '',
      'Options:',
      '  --dir <DRILL_DIR>  Drill directory with release artifacts (required)',
      '  --out <FILE>       Optional output path (default: <dir>/release-drill-manifest.json)',
      '  --json             Print the manifest JSON to stdout',
      '  --help             Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   missing artifact, invalid data, or runtime error',
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

function parseArgs(argv) {
  const args = {
    dir: '',
    out: '',
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        die(`missing value for ${arg}`, 64)
      }
      i += 1
      return next
    }

    switch (arg) {
      case '--dir':
        args.dir = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json':
        args.json = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) die('--dir is required', 64)
  if (args.out && !isNonEmptyString(args.out)) die('--out must not be blank', 64)

  return args
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function normalizePath(value) {
  return value.split(/[\\/]+/).join('/')
}

function artifactPathRelativeTo(drillDir, artifactPath) {
  return normalizePath(relative(drillDir, artifactPath))
}

async function readArtifact(drillDir, name) {
  const artifactPath = join(drillDir, name)
  const info = await stat(artifactPath)
  const content = await readFile(artifactPath)
  return {
    path: artifactPathRelativeTo(drillDir, artifactPath),
    sizeBytes: info.size,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

function extractReleaseAndStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { release: '', status: '' }

  const release = isNonEmptyString(value.release) ? value.release.trim() : ''
  const status = isNonEmptyString(value.status) ? value.status.trim() : ''
  return { release, status }
}

function deriveReleaseAndStatus(readiness, pack) {
  const readinessInfo = extractReleaseAndStatus(readiness)
  const packInfo = extractReleaseAndStatus(pack)

  const release = readinessInfo.release || packInfo.release
  const status = readinessInfo.status || packInfo.status

  if (!isNonEmptyString(release)) {
    throw new Error('unable to derive release from release-readiness.json or release-evidence-pack.json')
  }

  if (!isNonEmptyString(status)) {
    throw new Error('unable to derive status from release-readiness.json or release-evidence-pack.json')
  }

  return {
    release,
    status,
  }
}

async function ensureRequiredArtifacts(drillDir) {
  const missing = []

  for (const name of REQUIRED_ARTIFACTS) {
    try {
      await stat(join(drillDir, name))
    } catch (_) {
      missing.push(name)
    }
  }

  if (missing.length > 0) {
    throw new Error(`missing required artifact(s): ${missing.join(', ')}`)
  }
}

async function buildManifest(drillDir, options = {}) {
  const resolvedDrillDir = resolve(drillDir)
  const drillInfo = await stat(resolvedDrillDir)
  if (!drillInfo.isDirectory()) {
    throw new Error(`drill dir is not a directory: ${resolvedDrillDir}`)
  }

  await ensureRequiredArtifacts(resolvedDrillDir)

  const artifacts = []
  for (const name of REQUIRED_ARTIFACTS) {
    artifacts.push(await readArtifact(resolvedDrillDir, name))
  }

  const readiness = await readJson(join(resolvedDrillDir, 'release-readiness.json'))
  const pack = await readJson(join(resolvedDrillDir, 'release-evidence-pack.json'))
  const { release, status } = deriveReleaseAndStatus(readiness, pack)
  const createdAt = (options.now ?? new Date()).toISOString()

  return {
    createdAt,
    drillDir: resolvedDrillDir,
    release,
    status,
    artifacts,
  }
}

function renderHuman(manifest, outPath) {
  return [
    '# Release Drill Manifest',
    '',
    `- Drill dir: \`${manifest.drillDir}\``,
    `- Output: \`${outPath}\``,
    `- Created: \`${manifest.createdAt}\``,
    `- Release: \`${manifest.release}\``,
    `- Status: \`${manifest.status}\``,
    `- Artifacts: ${manifest.artifacts.length}`,
    '',
  ].join('\n')
}

async function writeJson(path, data) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  const json = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(outputPath, json, 'utf8')
  return { outputPath, json }
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv)
  const manifest = await buildManifest(args.dir, options)
  const outPath = args.out ? resolve(args.out) : join(resolve(args.dir), DEFAULT_OUTPUT_NAME)
  const { json } = await writeJson(outPath, manifest)

  process.stdout.write(args.json ? json : renderHuman(manifest, outPath))
  return manifest
}

async function main() {
  try {
    await runCli(process.argv.slice(2))
  } catch (err) {
    die(err instanceof Error ? err.message : String(err), 3)
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export { buildManifest, parseArgs, renderHuman, REQUIRED_ARTIFACTS }
