#!/usr/bin/env node

import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assessDecommissionReadiness } from './check-decommission-readiness.js'

const DEFAULT_DECOMMISSION_DIR = 'ops/decommission'
const DEFAULT_AO_GATE_FILE = 'ao-dependency-gate.json'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-production-readiness-summary.js [--dir <DIR>] [--ao-gate <FILE>] [--json] [--help]',
    '',
    'Options:',
    `  --dir <DIR>      Decommission artifact directory (default: ${DEFAULT_DECOMMISSION_DIR})`,
    '  --ao-gate <FILE> AO dependency gate JSON file (default: <dir>/ao-dependency-gate.json)',
    '  --json           Print JSON only',
    '  --help           Show this help',
    '',
    'Exit codes:',
    '  0   GO (ready for production closeout)',
    '  3   NO-GO (one or more blockers remain) or runtime error',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    dir: DEFAULT_DECOMMISSION_DIR,
    aoGate: '',
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      throw new CliError('help requested', 0)
    }
    if (arg === '--json') {
      args.json = true
      continue
    }

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--dir':
        args.dir = readValue()
        break
      case '--ao-gate':
        args.aoGate = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir must be a non-empty string', 64)
  if (!isNonEmptyString(args.aoGate)) args.aoGate = join(args.dir, DEFAULT_AO_GATE_FILE)

  return args
}

function uniqueStrings(values) {
  const seen = new Set()
  const output = []

  for (const value of values) {
    if (!isNonEmptyString(value)) continue
    const normalized = value.trim()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }

  return output
}

function normalizeFileLabel(value) {
  if (!isNonEmptyString(value)) return 'artifact'
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized.includes('/')) return normalized
  return basename(normalized)
}

function toActionableBlocker(message) {
  const normalized = isNonEmptyString(message) ? message.trim() : ''
  if (!normalized) return ''

  const missingArtifactMatch = /^missing required drill artifact: (.+)$/i.exec(normalized)
  if (missingArtifactMatch) {
    const file = normalizeFileLabel(missingArtifactMatch[1])
    if (file === 'ao-dependency-gate.json') {
      return 'Create ao-dependency-gate.json with required checks and closeout evidence links.'
    }
    return `Generate ${file} in the decommission drill artifact directory.`
  }

  const invalidJsonMatch = /^invalid JSON in (.+?): /i.exec(normalized)
  if (invalidJsonMatch) {
    const file = normalizeFileLabel(invalidJsonMatch[1])
    return `Fix invalid JSON in ${file}.`
  }

  if (/^release mismatch across drill artifacts:/i.test(normalized)) {
    return 'Align a single release value across decommission artifacts and the AO gate file.'
  }

  const statusMismatchMatch = /^([A-Za-z0-9._-]+\.json) status is (.+) \(expected (.+)\)$/i.exec(normalized)
  if (statusMismatchMatch) {
    const file = statusMismatchMatch[1]
    const current = statusMismatchMatch[2].trim()
    const expected = statusMismatchMatch[3].trim()
    return `Regenerate ${file} so status is ${expected} (current: ${current}).`
  }

  if (/^release-drill-check\.json is not ok$/i.test(normalized)) {
    return 'Rerun release drill checks until release-drill-check.json reports ok=true.'
  }

  const missingRequiredGateCheckMatch = /^ao gate missing required check: (.+)$/i.exec(normalized)
  if (missingRequiredGateCheckMatch) {
    const checkId = missingRequiredGateCheckMatch[1].trim()
    return `Add missing AO gate check ${checkId} to checks.`
  }

  const gateOpenCheckMatch = /^ao gate required check is not closed: ([^ ]+) \(([^)]+)\)$/i.exec(normalized)
  if (gateOpenCheckMatch) {
    const checkId = gateOpenCheckMatch[1].trim()
    const status = gateOpenCheckMatch[2].trim()
    return `Close AO gate check ${checkId} (current: ${status}) and attach evidence.`
  }

  if (/^ao gate\.required must be a non-empty array$/i.test(normalized)) {
    return 'Set ao-dependency-gate.json required to a non-empty list of mandatory checks.'
  }

  if (/^ao gate\.checks must be a non-empty array$/i.test(normalized)) {
    return 'Set ao-dependency-gate.json checks to include every required check entry.'
  }

  if (/^ao gate must be a JSON object$/i.test(normalized)) {
    return 'Fix ao-dependency-gate.json so the top-level value is a JSON object.'
  }

  if (/^unable to read /i.test(normalized)) {
    const file = normalizeFileLabel(normalized.replace(/^unable to read\s+/i, '').split(':')[0])
    return `Fix read access for ${file}.`
  }

  return normalized
}

function buildSummary(options = {}) {
  const dir = isNonEmptyString(options.dir) ? options.dir : DEFAULT_DECOMMISSION_DIR
  const aoGateFile = isNonEmptyString(options.aoGate) ? options.aoGate : join(dir, DEFAULT_AO_GATE_FILE)
  const readiness = assessDecommissionReadiness({ dir, aoGateFile })

  const automationBlockers = uniqueStrings(readiness.automationBlockers.map(toActionableBlocker))
  const aoManualBlockers = uniqueStrings(readiness.aoManualBlockers.map(toActionableBlocker))
  const blockers = uniqueStrings([...automationBlockers, ...aoManualBlockers])
  const decision = readiness.closeoutState === 'ready' ? 'GO' : 'NO-GO'

  if (decision === 'NO-GO' && blockers.length === 0) {
    blockers.push(`Resolve closeout state ${readiness.closeoutState}.`)
  }

  return {
    checkedAtUtc: readiness.checkedAtUtc,
    decision,
    status: decision === 'GO' ? 'ready' : 'blocked',
    release: readiness.release,
    closeoutState: readiness.closeoutState,
    automationState: readiness.automationState,
    aoManualState: readiness.aoManualState,
    blockerCount: blockers.length,
    blockers,
    blockerGroups: {
      automation: automationBlockers,
      aoManual: aoManualBlockers,
    },
    sources: {
      decommissionDir: readiness.dir,
      aoGateFile: readiness.aoGateFile,
    },
  }
}

function renderHuman(summary) {
  const lines = []
  lines.push('# Production Readiness GO/NO-GO')
  lines.push('')
  lines.push(`- Decision: \`${summary.decision}\``)
  lines.push(`- Closeout state: \`${summary.closeoutState}\``)
  lines.push(`- Automation state: \`${summary.automationState}\``)
  lines.push(`- AO/manual state: \`${summary.aoManualState}\``)
  lines.push(`- Blockers: ${summary.blockerCount}`)
  if (isNonEmptyString(summary.release)) lines.push(`- Release: \`${summary.release}\``)
  lines.push(`- Decommission dir: \`${summary.sources.decommissionDir}\``)
  lines.push(`- AO gate: \`${summary.sources.aoGateFile}\``)

  if (summary.blockers.length > 0) {
    lines.push('')
    lines.push('## Actionable blockers')
    for (const blocker of summary.blockers) {
      lines.push(`- ${blocker}`)
    }
  }

  return `${lines.join('\n')}\n`
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    const summary = buildSummary(args)
    return {
      exitCode: summary.decision === 'GO' ? 0 : 3,
      stdout: args.json ? `${JSON.stringify(summary, null, 2)}\n` : renderHuman(summary),
      stderr: '',
      summary,
    }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.exitCode === 0) {
        return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
      }
      return { exitCode: err.exitCode, stdout: `${usageText()}\n`, stderr: `error: ${err.message}\n` }
    }

    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}

function main() {
  const result = runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export {
  DEFAULT_AO_GATE_FILE,
  DEFAULT_DECOMMISSION_DIR,
  buildSummary,
  parseArgs,
  renderHuman,
  runCli,
  toActionableBlocker,
  usageText,
}
