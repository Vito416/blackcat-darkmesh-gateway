#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assessManualProofs } from './check-decommission-manual-proofs.js'
import { assessDecommissionReadiness } from './check-decommission-readiness.js'

const DEFAULT_DECOMMISSION_DIR = 'ops/decommission'
const DEFAULT_AO_GATE_FILE = 'ao-dependency-gate.json'
const DEFAULT_MANUAL_PROOF_LOG = 'decommission-evidence-log.json'

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
    '  node scripts/check-production-readiness-summary.js [--dir <DIR>] [--ao-gate <FILE>] [--manual-log <FILE>] [--json] [--help]',
    '',
    'Options:',
    `  --dir <DIR>      Decommission artifact directory (default: ${DEFAULT_DECOMMISSION_DIR})`,
    '  --ao-gate <FILE> AO dependency gate JSON file (default: <dir>/ao-dependency-gate.json)',
    '  --manual-log <FILE> Manual proof log JSON file (default: <dir>/decommission-evidence-log.json)',
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
    manualLog: '',
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
      case '--manual-log':
        args.manualLog = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir must be a non-empty string', 64)
  if (!isNonEmptyString(args.aoGate)) args.aoGate = join(args.dir, DEFAULT_AO_GATE_FILE)
  if (!isNonEmptyString(args.manualLog)) args.manualLog = join(args.dir, DEFAULT_MANUAL_PROOF_LOG)

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

  const missingManualLogMatch = /^missing manual proof log: (.+)$/i.exec(normalized)
  if (missingManualLogMatch) {
    const file = normalizeFileLabel(missingManualLogMatch[1])
    return `Generate ${file} with manual proof placeholders, then fill all required links.`
  }

  const missingManualProofMatch = /^missing manual proof link: (.+)$/i.exec(normalized)
  if (missingManualProofMatch) {
    const label = missingManualProofMatch[1].trim()
    return `Add ${label} link in decommission-evidence-log.json.`
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

function normalizeManualProofState(summary) {
  if (!summary || typeof summary !== 'object') return 'blocked'
  if (Array.isArray(summary.blockers) && summary.blockers.length > 0) return 'blocked'
  if (summary.status === 'complete') return 'complete'
  return 'pending'
}

function computeAoManualState(aoState, manualState) {
  if (aoState === 'blocked' || manualState === 'blocked') return 'blocked'
  if (aoState === 'pending' || manualState === 'pending') return 'pending'
  return 'complete'
}

function readManualProofSummary(manualProofFile) {
  let logRaw
  try {
    logRaw = readFileSync(manualProofFile, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      status: 'blocked',
      blockers: [`missing manual proof log: ${manualProofFile}`],
      warnings: [`unable to read ${manualProofFile}: ${reason}`],
      requiredCount: 0,
      providedCount: 0,
      missingCount: 0,
      missingProofLabels: [],
      proofs: [],
    }
  }

  let parsed
  try {
    parsed = JSON.parse(logRaw)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      status: 'blocked',
      blockers: [`invalid JSON in ${manualProofFile}: ${reason}`],
      warnings: [],
      requiredCount: 0,
      providedCount: 0,
      missingCount: 0,
      missingProofLabels: [],
      proofs: [],
    }
  }

  const summary = assessManualProofs(parsed)
  const blockers = [...summary.blockers]
  if (Array.isArray(summary.missingProofLabels)) {
    for (const label of summary.missingProofLabels) {
      blockers.push(`missing manual proof link: ${label}`)
    }
  }

  return {
    ...summary,
    blockers,
  }
}

function buildSummary(options = {}) {
  const dir = isNonEmptyString(options.dir) ? options.dir : DEFAULT_DECOMMISSION_DIR
  const aoGateFile = isNonEmptyString(options.aoGate) ? options.aoGate : join(dir, DEFAULT_AO_GATE_FILE)
  const manualProofFile = isNonEmptyString(options.manualLog) ? options.manualLog : join(dir, DEFAULT_MANUAL_PROOF_LOG)
  const resolvedManualProofFile = resolve(manualProofFile)
  const readiness = assessDecommissionReadiness({ dir, aoGateFile })
  const manualProofs = readManualProofSummary(resolvedManualProofFile)
  const manualProofState = normalizeManualProofState(manualProofs)
  const aoManualState = computeAoManualState(readiness.aoManualState, manualProofState)
  const closeoutState =
    readiness.automationState === 'complete'
      ? aoManualState === 'complete'
        ? 'ready'
        : aoManualState === 'pending'
          ? 'ao-manual-pending'
          : 'ao-manual-blocked'
      : 'automation-blocked'
  const automationBlockers = uniqueStrings(readiness.automationBlockers.map(toActionableBlocker))
  const aoManualBlockers = uniqueStrings(readiness.aoManualBlockers.map(toActionableBlocker))
  const manualProofBlockers = uniqueStrings((manualProofs.blockers || []).map(toActionableBlocker))
  const blockers = uniqueStrings([...automationBlockers, ...aoManualBlockers, ...manualProofBlockers])
  const decision = closeoutState === 'ready' ? 'GO' : 'NO-GO'

  if (decision === 'NO-GO' && blockers.length === 0) {
    blockers.push(`Resolve closeout state ${closeoutState}.`)
  }

  return {
    checkedAtUtc: readiness.checkedAtUtc,
    decision,
    status: decision === 'GO' ? 'ready' : 'blocked',
    release: readiness.release,
    closeoutState,
    automationState: readiness.automationState,
    aoManualState,
    manualProofState,
    blockerCount: blockers.length,
    blockers,
    blockerGroups: {
      automation: automationBlockers,
      aoManual: aoManualBlockers,
      manualProofs: manualProofBlockers,
    },
    manualProofs: {
      file: resolvedManualProofFile,
      status: manualProofs.status,
      requiredCount: manualProofs.requiredCount,
      providedCount: manualProofs.providedCount,
      missingCount: manualProofs.missingCount,
      missingProofLabels: manualProofs.missingProofLabels,
    },
    sources: {
      decommissionDir: readiness.dir,
      aoGateFile: readiness.aoGateFile,
      manualProofFile: resolvedManualProofFile,
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
  lines.push(`- Manual proof state: \`${summary.manualProofState}\``)
  lines.push(
    `- Manual proofs: ${summary.manualProofs.providedCount}/${summary.manualProofs.requiredCount} (missing ${summary.manualProofs.missingCount})`,
  )
  lines.push(`- Blockers: ${summary.blockerCount}`)
  if (isNonEmptyString(summary.release)) lines.push(`- Release: \`${summary.release}\``)
  lines.push(`- Decommission dir: \`${summary.sources.decommissionDir}\``)
  lines.push(`- AO gate: \`${summary.sources.aoGateFile}\``)
  lines.push(`- Manual proof log: \`${summary.sources.manualProofFile}\``)

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
