#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-release-signoff-checklist.js --pack <FILE> [--out <FILE>] [--strict]',
      '',
      'Options:',
      '  --pack <FILE>    Release pack JSON to summarize (required)',
      '  --out <FILE>     Optional markdown output path',
      '  --strict         Exit 3 when pack.status is not "ready"',
      '  --help           Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   strict-not-ready or data error',
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
    pack: '',
    out: '',
    strict: false,
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
      case '--pack':
        args.pack = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--strict':
        args.strict = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.pack)) die('--pack is required', 64)
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

function normalizeStatus(value, fieldName) {
  if (!isNonEmptyString(value)) throw new Error(`${fieldName} must be a non-empty string`)
  return value.trim().toLowerCase()
}

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`)
  const out = []
  for (const entry of value) {
    if (!isNonEmptyString(entry)) continue
    out.push(entry.trim())
  }
  return out
}

function normalizeSection(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }

  const status = normalizeStatus(value.status, `${fieldName}.status`)
  const reason = isNonEmptyString(value.reason) ? value.reason.trim() : ''

  return {
    status,
    reason,
  }
}

async function readReleasePack(path) {
  const resolved = resolve(path)
  const raw = await readJson(resolved)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('release pack must be a JSON object')
  }

  const status = normalizeStatus(raw.status, 'release pack.status')
  const blockers = normalizeStringList(raw.blockers ?? [], 'release pack.blockers')
  const warnings = normalizeStringList(raw.warnings ?? [], 'release pack.warnings')
  const consistency = normalizeSection(raw.consistency, 'release pack.consistency')
  const evidence = normalizeSection(raw.evidence, 'release pack.evidence')
  const aoGate = normalizeSection(raw.aoGate, 'release pack.aoGate')

  const release = isNonEmptyString(raw.release) ? raw.release.trim() : ''
  const createdAt = isNonEmptyString(raw.createdAt) ? raw.createdAt.trim() : ''

  return {
    sourcePath: path,
    resolvedPath: resolved,
    release,
    createdAt,
    status,
    blockers,
    warnings,
    consistency,
    evidence,
    aoGate,
  }
}

function formatStatusLine(label, section) {
  const reason = section.reason ? ` — ${section.reason}` : ''
  return `- ${label}: \`${section.status}\`${reason}`
}

function formatChecklistItem(label) {
  return `- [ ] ${label}`
}

function formatListSection(title, items) {
  const lines = [`## ${title}`]
  if (items.length === 0) {
    lines.push('- [x] None')
    lines.push('')
    return lines
  }

  for (const item of items) lines.push(`- [ ] ${item}`)
  lines.push('')
  return lines
}

function renderChecklist(pack) {
  const lines = ['# Release Sign-off Checklist', '']
  lines.push(`- Pack: \`${pack.sourcePath}\``)
  if (pack.release) lines.push(`- Release: \`${pack.release}\``)
  if (pack.createdAt) lines.push(`- Generated: \`${pack.createdAt}\``)
  lines.push(`- Pack status: \`${pack.status}\``)
  lines.push('')

  lines.push('## Status')
  lines.push(formatStatusLine('AO gate', pack.aoGate))
  lines.push(formatStatusLine('Consistency', pack.consistency))
  lines.push(formatStatusLine('Evidence bundle', pack.evidence))
  lines.push('')

  lines.push('## Checklist')
  lines.push(formatChecklistItem('Confirm AO gate is acceptable'))
  lines.push(formatChecklistItem('Confirm consistency is acceptable'))
  lines.push(formatChecklistItem('Confirm evidence bundle is acceptable'))
  lines.push(formatChecklistItem('Review blockers and warnings below'))
  lines.push('')

  lines.push(...formatListSection('Blockers', pack.blockers))
  lines.push(...formatListSection('Warnings', pack.warnings))

  return `${lines.join('\n')}\n`
}

async function writeText(path, content) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const pack = await readReleasePack(args.pack)
  const markdown = renderChecklist(pack)

  if (args.out) {
    await writeText(args.out, markdown)
  }

  process.stdout.write(markdown)

  if (args.strict && pack.status !== 'ready') {
    process.exit(3)
  }
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

export {
  parseArgs,
  readReleasePack,
  renderChecklist,
  runCli,
}
