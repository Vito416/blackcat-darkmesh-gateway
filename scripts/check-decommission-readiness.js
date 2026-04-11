#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_ARTIFACTS = [
  { key: 'release-evidence-pack', file: 'release-evidence-pack.json', json: true },
  { key: 'release-readiness', file: 'release-readiness.json', json: true },
  { key: 'release-drill-manifest', file: 'release-drill-manifest.json', json: true },
  { key: 'release-drill-check', file: 'release-drill-check.json', json: true },
  { key: 'release-evidence-ledger', file: 'release-evidence-ledger.json', json: true },
]

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
    '  node scripts/check-decommission-readiness.js --dir <DRILL_DIR> --ao-gate <FILE> [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --dir <DRILL_DIR>   Drill artifact directory to inspect (required)',
    '  --ao-gate <FILE>    AO dependency gate JSON file (required)',
    '  --json              Print structured JSON only',
    '  --strict            Exit 3 when blockers are present',
    '  --help              Show this help',
    '',
    'Exit codes:',
    '  0   readiness summary emitted successfully',
    '  3   blocked in strict mode, or invalid/blocked readiness state',
    '  64  usage error',
  ].join('\n')
}

function usage(exitCode = 0) {
  console.log(usageText())
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    dir: '',
    aoGate: '',
    json: false,
    strict: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '--strict') {
      args.strict = true
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

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir is required', 64)
  if (!isNonEmptyString(args.aoGate)) throw new CliError('--ao-gate is required', 64)

  return args
}

function normalizeStatus(value) {
  return isNonEmptyString(value) ? value.trim().toLowerCase() : ''
}

function readJsonArtifact(dir, file, blockers) {
  const path = resolve(dir, file)
  let present = false
  try {
    const stat = statSync(path)
    present = stat.isFile()
    if (!present) {
      blockers.push(`missing required drill artifact: ${file}`)
      return { present: false, valid: false, value: null, path }
    }
  } catch (_) {
    blockers.push(`missing required drill artifact: ${file}`)
    return { present: false, valid: false, value: null, path }
  }

  try {
    const raw = readFileSync(path, 'utf8')
    return { present: true, valid: true, value: JSON.parse(raw), path }
  } catch (err) {
    blockers.push(`invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return { present: true, valid: false, value: null, path }
  }
}

function readTextArtifact(dir, file, blockers) {
  const path = resolve(dir, file)
  try {
    const stat = statSync(path)
    if (!stat.isFile()) {
      blockers.push(`missing required drill artifact: ${file}`)
      return { present: false, valid: false, value: '', path }
    }
  } catch (_) {
    blockers.push(`missing required drill artifact: ${file}`)
    return { present: false, valid: false, value: '', path }
  }

  try {
    return { present: true, valid: true, value: readFileSync(path, 'utf8'), path }
  } catch (err) {
    blockers.push(`unable to read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return { present: true, valid: false, value: '', path }
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))]
}

function collectGateChecks(gate, aoManualBlockers) {
  const summary = {
    present: !!gate,
    valid: false,
    release: '',
    requiredCount: 0,
    closedCount: 0,
    openCount: 0,
    missingRequiredChecks: [],
    openChecks: [],
    status: 'blocked',
  }

  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    aoManualBlockers.push('ao gate must be a JSON object')
    return summary
  }

  summary.release = isNonEmptyString(gate.release) ? gate.release.trim() : ''

  if (!Array.isArray(gate.required) || gate.required.length === 0) {
    aoManualBlockers.push('ao gate.required must be a non-empty array')
    return summary
  }
  if (!Array.isArray(gate.checks) || gate.checks.length === 0) {
    aoManualBlockers.push('ao gate.checks must be a non-empty array')
    return summary
  }

  const requiredIds = uniqueStrings(gate.required)
  summary.requiredCount = requiredIds.length

  const checksById = new Map()
  for (const check of gate.checks) {
    if (check && typeof check === 'object' && !Array.isArray(check) && isNonEmptyString(check.id)) {
      checksById.set(check.id.trim(), check)
    }
  }

  for (const requiredId of requiredIds) {
    const check = checksById.get(requiredId)
    if (!check) {
      summary.missingRequiredChecks.push(requiredId)
      aoManualBlockers.push(`ao gate missing required check: ${requiredId}`)
      continue
    }

    const status = normalizeStatus(check.status)
    if (status !== 'closed') {
      summary.openCount += 1
      summary.openChecks.push(requiredId)
      aoManualBlockers.push(`ao gate required check is not closed: ${requiredId} (${status || 'missing status'})`)
      continue
    }

    summary.closedCount += 1
  }

  if (summary.missingRequiredChecks.length > 0) {
    summary.status = 'blocked'
  } else if (summary.openChecks.length > 0) {
    summary.status = 'pending'
  } else {
    summary.status = 'complete'
  }

  summary.valid = summary.status === 'complete'
  return summary
}

function assessDecommissionReadiness({ dir, aoGateFile }) {
  const blockers = []
  const automationBlockers = []
  const aoManualBlockers = []
  const resolvedDir = resolve(dir)
  const resolvedGate = resolve(aoGateFile)

  const artifacts = {}
  for (const entry of REQUIRED_ARTIFACTS) {
    artifacts[entry.key] = readJsonArtifact(resolvedDir, entry.file, automationBlockers)
  }

  const gateArtifact = readJsonArtifact('.', resolvedGate, aoManualBlockers)
  const gate = gateArtifact.valid ? gateArtifact.value : null
  const gateSummary = collectGateChecks(gate, aoManualBlockers)

  const pack = artifacts['release-evidence-pack'].value
  const readiness = artifacts['release-readiness'].value
  const manifest = artifacts['release-drill-manifest'].value
  const drillCheck = artifacts['release-drill-check'].value
  const ledger = artifacts['release-evidence-ledger'].value

  const packStatus = normalizeStatus(pack?.status)
  const readinessStatus = normalizeStatus(readiness?.status)
  const manifestStatus = normalizeStatus(manifest?.status)
  const ledgerStatus = normalizeStatus(ledger?.overallStatus || ledger?.status)
  const drillCheckOk = drillCheck?.ok === true

  if (artifacts['release-evidence-pack'].present && packStatus !== 'ready') {
    automationBlockers.push(`release-evidence-pack.json status is ${packStatus || 'missing'} (expected ready)`)
  }
  if (artifacts['release-readiness'].present && readinessStatus !== 'ready') {
    automationBlockers.push(`release-readiness.json status is ${readinessStatus || 'missing'} (expected ready)`)
  }
  if (artifacts['release-drill-manifest'].present && manifestStatus !== 'ready') {
    automationBlockers.push(`release-drill-manifest.json status is ${manifestStatus || 'missing'} (expected ready)`)
  }
  if (artifacts['release-drill-check'].present && !drillCheckOk) {
    automationBlockers.push('release-drill-check.json is not ok')
  }
  if (artifacts['release-evidence-ledger'].present && ledgerStatus !== 'ready') {
    automationBlockers.push(`release-evidence-ledger.json status is ${ledgerStatus || 'missing'} (expected ready)`)
  }

  const releaseValues = uniqueStrings([
    pack?.release,
    readiness?.release,
    manifest?.release,
    ledger?.release,
    gate?.release,
  ])
  if (releaseValues.length > 1) {
    automationBlockers.push(`release mismatch across drill artifacts: ${releaseValues.join(', ')}`)
  }

  const release = releaseValues[0] || ''
  const automationState = automationBlockers.length === 0 ? 'complete' : 'blocked'
  const aoManualState = gateSummary.status
  const closeoutState =
    automationState === 'complete'
      ? aoManualState === 'complete'
        ? 'ready'
        : aoManualState === 'pending'
          ? 'ao-manual-pending'
          : 'ao-manual-blocked'
      : 'automation-blocked'
  const status = closeoutState === 'ready' ? 'ready' : 'blocked'
  blockers.push(...automationBlockers)
  blockers.push(...aoManualBlockers)

  return {
    checkedAtUtc: new Date().toISOString(),
    dir: resolvedDir,
    aoGateFile: resolvedGate,
    release,
    status,
    closeoutState,
    automationState,
    aoManualState,
    blockerCount: blockers.length,
    blockers,
    automationBlockers,
    aoManualBlockers,
    checks: {
      automation: {
        status: automationState,
        blockerCount: automationBlockers.length,
        blockers: automationBlockers,
        artifactCount: REQUIRED_ARTIFACTS.length,
        releaseAligned: releaseValues.length <= 1,
      },
      aoManual: {
        status: aoManualState,
        blockerCount: aoManualBlockers.length,
        blockers: aoManualBlockers,
        requiredCount: gateSummary.requiredCount,
        closedCount: gateSummary.closedCount,
        openCount: gateSummary.openCount,
        missingRequiredChecks: [...gateSummary.missingRequiredChecks],
        openChecks: [...gateSummary.openChecks],
      },
      releaseEvidencePack: {
        present: artifacts['release-evidence-pack'].present,
        valid: artifacts['release-evidence-pack'].valid,
        status: packStatus,
        release: isNonEmptyString(pack?.release) ? pack.release.trim() : '',
      },
      releaseReadiness: {
        present: artifacts['release-readiness'].present,
        valid: artifacts['release-readiness'].valid,
        status: readinessStatus,
        blockerCount: Number.isInteger(readiness?.blockerCount) ? readiness.blockerCount : null,
        warningCount: Number.isInteger(readiness?.warningCount) ? readiness.warningCount : null,
        release: isNonEmptyString(readiness?.release) ? readiness.release.trim() : '',
      },
      releaseDrillManifest: {
        present: artifacts['release-drill-manifest'].present,
        valid: artifacts['release-drill-manifest'].valid,
        status: manifestStatus,
        artifactsCount: Array.isArray(manifest?.artifacts) ? manifest.artifacts.length : null,
        release: isNonEmptyString(manifest?.release) ? manifest.release.trim() : '',
      },
      releaseDrillCheck: {
        present: artifacts['release-drill-check'].present,
        valid: artifacts['release-drill-check'].valid,
        ok: drillCheckOk,
        missingCount: Array.isArray(drillCheck?.missing) ? drillCheck.missing.length : null,
        issueCount: Array.isArray(drillCheck?.issues) ? drillCheck.issues.length : null,
      },
      releaseEvidenceLedger: {
        present: artifacts['release-evidence-ledger'].present,
        valid: artifacts['release-evidence-ledger'].valid,
        status: ledgerStatus,
        release: isNonEmptyString(ledger?.release) ? ledger.release.trim() : '',
      },
      aoGate: gateSummary,
    },
  }
}

function renderHuman(summary) {
  const lines = []
  lines.push('# Decommission Readiness')
  lines.push('')
  lines.push(`- Checked at (UTC): \`${summary.checkedAtUtc}\``)
  lines.push(`- Directory: \`${summary.dir}\``)
  lines.push(`- AO gate: \`${summary.aoGateFile}\``)
  if (isNonEmptyString(summary.release)) lines.push(`- Release: \`${summary.release}\``)
  lines.push(`- Status: \`${summary.status}\``)
  lines.push(`- Closeout state: \`${summary.closeoutState}\``)
  lines.push(`- Automation state: \`${summary.automationState}\``)
  lines.push(`- AO/manual state: \`${summary.aoManualState}\``)
  lines.push(`- Blockers: ${summary.blockerCount}`)
  lines.push('')

  lines.push('## State split')
  lines.push(
    `- Automation: ${summary.checks.automation.status} (${summary.checks.automation.blockerCount} blocker${summary.checks.automation.blockerCount === 1 ? '' : 's'})`,
  )
  lines.push(
    `- AO/manual: ${summary.checks.aoManual.status} (${summary.checks.aoManual.openCount} open, ${summary.checks.aoManual.missingRequiredChecks.length} missing required)`,
  )
  lines.push('')

  lines.push('## Artifact checks')
  lines.push(
    `- release-evidence-pack.json: ${summary.checks.releaseEvidencePack.present ? 'present' : 'missing'} / ${summary.checks.releaseEvidencePack.status || 'n/a'}`,
  )
  lines.push(
    `- release-readiness.json: ${summary.checks.releaseReadiness.present ? 'present' : 'missing'} / ${summary.checks.releaseReadiness.status || 'n/a'}`,
  )
  lines.push(
    `- release-drill-manifest.json: ${summary.checks.releaseDrillManifest.present ? 'present' : 'missing'} / ${summary.checks.releaseDrillManifest.status || 'n/a'}`,
  )
  lines.push(
    `- release-drill-check.json: ${summary.checks.releaseDrillCheck.present ? 'present' : 'missing'} / ${summary.checks.releaseDrillCheck.ok ? 'ok' : 'not ok'}`,
  )
  lines.push(
    `- release-evidence-ledger.json: ${summary.checks.releaseEvidenceLedger.present ? 'present' : 'missing'} / ${summary.checks.releaseEvidenceLedger.status || 'n/a'}`,
  )
  lines.push(
    `- AO gate checks: required ${summary.checks.aoGate.requiredCount}, closed ${summary.checks.aoGate.closedCount}, open ${summary.checks.aoGate.openCount}`,
  )
  lines.push('')

  if (summary.blockers.length > 0) {
    lines.push('## Blockers')
    for (const blocker of summary.blockers) lines.push(`- ${blocker}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    const summary = assessDecommissionReadiness({ dir: args.dir, aoGateFile: args.aoGate })
    const output = args.json ? `${JSON.stringify(summary, null, 2)}\n` : renderHuman(summary)

    return {
      exitCode: args.strict && summary.blockerCount > 0 ? 3 : 0,
      stdout: output,
      stderr: '',
      summary,
    }
  } catch (err) {
    if (err instanceof CliError) {
      return {
        exitCode: err.exitCode,
        stdout: `${usageText()}\n`,
        stderr: `error: ${err.message}\n`,
      }
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

export { REQUIRED_ARTIFACTS, assessDecommissionReadiness, parseArgs, renderHuman, runCli }
