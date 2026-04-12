#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/check-release-readiness.js --pack <path> [--strict] [--json] [--help]',
      '',
      'Options:',
      '  --pack <path>   release-evidence-pack.json to evaluate (required)',
      '  --strict        Exit 3 when status is warning or blocked',
      '  --json          Print structured JSON only',
      '  --help          Show this help',
      '',
      'Exit codes:',
      '  0   ready or warning in non-strict mode',
      '  3   blocked or strict+not-ready, or data error',
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseArgs(argv) {
  const args = {
    pack: '',
    strict: false,
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
      case '--pack':
        args.pack = readValue()
        break
      case '--strict':
        args.strict = true
        break
      case '--json':
        args.json = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.pack)) die('--pack is required', 64)
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

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`)
  return value.filter(isNonEmptyString).map((entry) => entry.trim())
}

function normalizeOptionalSection(value, fieldName) {
  if (typeof value === 'undefined' || value === null) return null
  if (!isPlainObject(value)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }

  if (!isNonEmptyString(value.status)) {
    throw new Error(`${fieldName}.status must be a non-empty string`)
  }

  const status = value.status.trim().toLowerCase()
  const reason = isNonEmptyString(value.reason) ? value.reason.trim() : ''
  const findingCount =
    Number.isInteger(value.findingCount) && value.findingCount >= 0 ? value.findingCount : undefined

  return {
    status,
    reason,
    findingCount,
  }
}

const OPTIONAL_EVIDENCE_SECTION_LABELS = {
  coreExtraction: 'core extraction evidence',
  legacyCryptoBoundary: 'legacy crypto boundary evidence',
  templateSignatureRefMap: 'template signature-ref map evidence',
  templateWorkerMapCoherence: 'template worker map coherence evidence',
  forgetForwardConfig: 'forget-forward config evidence',
}

function isPassLikeStatus(status) {
  return (
    status === 'pass' ||
    status === 'ok' ||
    status === 'closed' ||
    status === 'complete' ||
    status === 'ready' ||
    status === 'success'
  )
}

function isWarnLikeStatus(status) {
  return status === 'warn' || status === 'warning' || status === 'degraded' || status === 'pending'
}

function normalizeOptionalEvidenceSection(value, fieldName) {
  if (typeof value === 'undefined' || value === null) return null
  if (!isPlainObject(value)) {
    return {
      present: true,
      status: 'invalid',
      reason: `${fieldName} must be a JSON object`,
    }
  }

  if (!isNonEmptyString(value.status)) {
    return {
      present: true,
      status: 'missing-required',
      reason: `${fieldName}.status must be a non-empty string`,
    }
  }

  return {
    present: true,
    status: value.status.trim().toLowerCase(),
    reason: isNonEmptyString(value.reason) ? value.reason.trim() : '',
  }
}

function collectOptionalEvidenceSource(raw) {
  if (typeof raw.optionalEvidence !== 'undefined' && raw.optionalEvidence !== null) {
    if (!isPlainObject(raw.optionalEvidence)) {
      throw new Error('release pack.optionalEvidence must be a JSON object')
    }
    return raw.optionalEvidence
  }

  const source = {}
  let found = false
  for (const key of Object.keys(OPTIONAL_EVIDENCE_SECTION_LABELS)) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      source[key] = raw[key]
      found = true
    }
  }
  return found ? source : null
}

function normalizeOptionalEvidenceGroup(raw) {
  const source = collectOptionalEvidenceSource(raw)
  if (!source) return null

  return {
    coreExtraction: normalizeOptionalEvidenceSection(source.coreExtraction, 'release pack.optionalEvidence.coreExtraction'),
    legacyCryptoBoundary: normalizeOptionalEvidenceSection(
      source.legacyCryptoBoundary,
      'release pack.optionalEvidence.legacyCryptoBoundary',
    ),
    templateSignatureRefMap: normalizeOptionalEvidenceSection(
      source.templateSignatureRefMap,
      'release pack.optionalEvidence.templateSignatureRefMap',
    ),
    templateWorkerMapCoherence: normalizeOptionalEvidenceSection(
      source.templateWorkerMapCoherence,
      'release pack.optionalEvidence.templateWorkerMapCoherence',
    ),
    forgetForwardConfig: normalizeOptionalEvidenceSection(
      source.forgetForwardConfig,
      'release pack.optionalEvidence.forgetForwardConfig',
    ),
  }
}

function formatBoundaryMessage(label, section) {
  const reason =
    section.reason ||
    (typeof section.findingCount === 'number'
      ? `${section.findingCount} finding${section.findingCount === 1 ? '' : 's'}`
      : 'no additional details')

  if (isWarnLikeStatus(section.status)) {
    return `${label} warning: ${reason}`
  }

  return `${label} status=${section.status}: ${reason}`
}

export async function readReleasePack(path) {
  const resolvedPath = resolve(path)
  const raw = await readJson(resolvedPath)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('release pack must be a JSON object')
  }

  if (!isNonEmptyString(raw.release)) {
    throw new Error('release pack.release must be a non-empty string')
  }

  return {
    sourcePath: path,
    resolvedPath,
    release: raw.release.trim(),
    blockers: normalizeStringList(raw.blockers ?? [], 'release pack.blockers'),
    warnings: normalizeStringList(raw.warnings ?? [], 'release pack.warnings'),
    installerRuntimeBoundary: normalizeOptionalSection(
      raw.installerRuntimeBoundary ?? raw.installerBoundary,
      'release pack.installerRuntimeBoundary',
    ),
    optionalEvidence: normalizeOptionalEvidenceGroup(raw),
  }
}

export function assessReleaseReadiness(pack) {
  const blockers = [...pack.blockers]
  const warnings = [...pack.warnings]

  if (pack.installerRuntimeBoundary) {
    const section = pack.installerRuntimeBoundary
    if (isWarnLikeStatus(section.status)) {
      warnings.push(formatBoundaryMessage('installer runtime boundary', section))
    } else if (!isPassLikeStatus(section.status)) {
      blockers.push(formatBoundaryMessage('installer runtime boundary', section))
    }
  }

  if (pack.optionalEvidence) {
    for (const [key, section] of Object.entries(pack.optionalEvidence)) {
      if (!section || section.present !== true) continue
      const label = OPTIONAL_EVIDENCE_SECTION_LABELS[key]
      if (!label) continue

      if (isPassLikeStatus(section.status)) {
        continue
      }

      const reason = isNonEmptyString(section.reason) ? section.reason : `status=${section.status}`
      if (isWarnLikeStatus(section.status)) {
        warnings.push(`${label} warning: ${reason}`)
      } else {
        blockers.push(`${label} blocker: status=${section.status}: ${reason}`)
      }
    }
  }

  const blockerCount = blockers.length
  const warningCount = warnings.length
  const status = blockerCount > 0 ? 'blocked' : warningCount > 0 ? 'warning' : 'ready'

  return {
    status,
    blockerCount,
    warningCount,
    release: pack.release,
    blockers,
    warnings,
  }
}

export function renderHuman(result) {
  const lines = []
  lines.push('# Release Readiness')
  lines.push('')
  lines.push(`- Release: \`${result.release}\``)
  lines.push(`- Status: \`${result.status}\``)
  lines.push(`- Blockers: ${result.blockerCount}`)
  lines.push(`- Warnings: ${result.warningCount}`)
  lines.push('')

  if (result.blockers.length > 0) {
    lines.push('## Blockers')
    for (const item of result.blockers) lines.push(`- ${item}`)
    lines.push('')
  }

  if (result.warnings.length > 0) {
    lines.push('## Warnings')
    for (const item of result.warnings) lines.push(`- ${item}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const pack = await readReleasePack(args.pack)
  const result = assessReleaseReadiness(pack)

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: result.status,
          blockerCount: result.blockerCount,
          warningCount: result.warningCount,
          release: result.release,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    process.stdout.write(renderHuman(result))
  }

  if (args.strict && result.status !== 'ready') {
    process.exit(3)
  }

  if (result.status === 'blocked') {
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

export { parseArgs }
