#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function usage(exitCode = 0) {
  console.log([
    'Usage:',
    '  node scripts/init-template-worker-routing.js --sites <csv> [--url-map-out <file>] [--token-map-out <file>] [--force]',
    '',
    'Options:',
    '  --sites <CSV>          Required comma-separated site IDs',
    '  --url-map-out <file>   Output JSON file for site -> worker URL map (default: tmp/template-worker-url-map.json)',
    '  --token-map-out <file> Output JSON file for site -> token map (default: tmp/template-worker-token-map.json)',
    '  --force                Allow overwriting existing output files',
    '  --help                 Show this help',
    '',
    'Exit codes:',
    '  0   success',
    '  3   runtime / overwrite error',
    '  64  usage error',
  ].join('\n'))
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseSitesCsv(raw) {
  if (!isNonEmptyString(raw)) {
    throw new Error('--sites must be a non-empty comma-separated list')
  }

  const sites = raw
    .split(',')
    .map((site) => site.trim())
    .filter((site) => site.length > 0)

  if (sites.length === 0) {
    throw new Error('--sites must contain at least one non-empty site ID')
  }

  const seen = new Set()
  const duplicates = []
  for (const site of sites) {
    if (seen.has(site)) {
      duplicates.push(site)
      continue
    }
    seen.add(site)
  }

  if (duplicates.length > 0) {
    throw new Error(`--sites contains duplicate site IDs: ${duplicates.join(', ')}`)
  }

  return sites
}

function buildUrlMap(sites) {
  const map = {}
  for (const site of sites) {
    map[site] = `https://worker-${site}.example.invalid`
  }
  return map
}

function buildTokenMap(sites) {
  const map = {}
  for (const site of sites) {
    map[site] = `replace-with-token-for-${site}`
  }
  return map
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(resolve(filePath)), { recursive: true })
}

function writeJsonFile(filePath, payload, force) {
  const resolved = resolve(filePath)
  if (existsSync(resolved) && !force) {
    throw new Error(`refusing to overwrite existing file: ${filePath}`)
  }

  ensureParentDir(resolved)
  writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return resolved
}

function assessTemplateWorkerRoutingScaffold({ sitesRaw, urlMapOut, tokenMapOut, force }) {
  const sites = parseSitesCsv(sitesRaw)
  const urlMap = buildUrlMap(sites)
  const tokenMap = buildTokenMap(sites)

  const urlMapPath = writeJsonFile(urlMapOut, urlMap, force)
  const tokenMapPath = writeJsonFile(tokenMapOut, tokenMap, force)

  return {
    status: 'complete',
    siteCount: sites.length,
    sites,
    urlMapPath,
    tokenMapPath,
  }
}

async function main() {
  const argv = process.argv.slice(2)
  let sitesRaw = null
  let urlMapOut = 'tmp/template-worker-url-map.json'
  let tokenMapOut = 'tmp/template-worker-token-map.json'
  let force = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--sites') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --sites')
      sitesRaw = next
      i += 1
      continue
    }
    if (arg === '--url-map-out') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --url-map-out')
      urlMapOut = next
      i += 1
      continue
    }
    if (arg === '--token-map-out') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --token-map-out')
      tokenMapOut = next
      i += 1
      continue
    }
    if (arg.startsWith('--')) die(`unknown option: ${arg}`)
    die(`unexpected positional argument: ${arg}`)
  }

  if (!isNonEmptyString(sitesRaw)) {
    die('--sites is required')
  }

  try {
    const result = assessTemplateWorkerRoutingScaffold({
      sitesRaw,
      urlMapOut,
      tokenMapOut,
      force,
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(3)
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    die(err instanceof Error ? err.message : String(err), 3)
  })
}

export {
  assessTemplateWorkerRoutingScaffold,
  buildTokenMap,
  buildUrlMap,
  isNonEmptyString,
  parseSitesCsv,
  writeJsonFile,
}
