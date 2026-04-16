#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { DECOMMISSION_READINESS_ARTIFACT_REQUIREMENTS } from './run-release-drill.js'

const REQUIRED_ARTIFACTS = DECOMMISSION_READINESS_ARTIFACT_REQUIREMENTS.map((entry) => ({
  key: entry.key,
  file: entry.file,
  aliases: Array.isArray(entry.aliases) ? [...entry.aliases] : [],
  json: true,
}))
const DRILL_CHECK_EMBEDDED_JSON_FIELDS = Object.freeze([
  {
    field: 'legacyCoreExtractionEvidence',
    artifactKey: 'legacy-core-extraction-evidence',
    file: 'legacy-core-extraction-evidence.json',
  },
  {
    field: 'legacyCryptoBoundaryEvidence',
    artifactKey: 'legacy-crypto-boundary-evidence',
    file: 'legacy-crypto-boundary-evidence.json',
  },
  {
    field: 'templateWorkerMapCoherence',
    artifactKey: 'template-worker-map-coherence',
    file: 'template-worker-map-coherence.json',
  },
  {
    field: 'forgetForwardConfig',
    artifactKey: 'forget-forward-config',
    file: 'forget-forward-config.json',
  },
  {
    field: 'templateSignatureRefMap',
    artifactKey: 'template-signature-ref-map',
    file: 'template-signature-ref-map.json',
  },
  {
    field: 'templateVariantMap',
    artifactKey: 'template-variant-map',
    file: 'template-variant-map.json',
  },
])

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

function resolveArtifactPath(dir, requirement) {
  const names = [requirement.file, ...(Array.isArray(requirement.aliases) ? requirement.aliases : [])]
  for (const name of names) {
    const path = resolve(dir, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) continue
      return {
        path,
        actualFile: name,
        usedAlias: name !== requirement.file,
      }
    } catch (_) {
      // continue
    }
  }

  return {
    path: resolve(dir, requirement.file),
    actualFile: requirement.file,
    usedAlias: false,
  }
}

function readJsonArtifact(dir, requirement, blockers) {
  const resolved = resolveArtifactPath(dir, requirement)
  const file = requirement.file
  const path = resolved.path

  try {
    const stat = statSync(path)
    if (!stat.isFile()) {
      blockers.push(`missing required drill artifact: ${file}`)
      return { present: false, valid: false, value: null, path, file, actualFile: file, usedAlias: false }
    }
  } catch (_) {
    blockers.push(`missing required drill artifact: ${file}`)
    return { present: false, valid: false, value: null, path, file, actualFile: file, usedAlias: false }
  }

  try {
    const raw = readFileSync(path, 'utf8')
    return {
      present: true,
      valid: true,
      value: JSON.parse(raw),
      path,
      file,
      actualFile: resolved.actualFile,
      usedAlias: resolved.usedAlias,
    }
  } catch (err) {
    blockers.push(`invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return {
      present: true,
      valid: false,
      value: null,
      path,
      file,
      actualFile: resolved.actualFile,
      usedAlias: resolved.usedAlias,
    }
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))]
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value)
}

function isAoGateRelatedMessage(value) {
  if (!isNonEmptyString(value)) return false
  const text = value.trim().toLowerCase()
  return text.includes('ao dependency gate') || text.includes('ao gate')
}

function collectEvidenceStatusSignals(payload) {
  const blockers = normalizeStringArray(payload?.blockers)
  const warnings = normalizeStringArray(payload?.warnings)
  const aoBlockers = blockers.filter((entry) => isAoGateRelatedMessage(entry))
  const nonAoBlockers = blockers.filter((entry) => !isAoGateRelatedMessage(entry))
  const aoWarnings = warnings.filter((entry) => isAoGateRelatedMessage(entry))
  const nonAoWarnings = warnings.filter((entry) => !isAoGateRelatedMessage(entry))

  return {
    blockers,
    warnings,
    aoBlockers,
    nonAoBlockers,
    aoWarnings,
    nonAoWarnings,
    aoOnlyBlocked: nonAoBlockers.length === 0 && aoBlockers.length > 0,
    aoOnlyWarning: nonAoWarnings.length === 0 && aoWarnings.length > 0,
  }
}

function isLedgerBlockedByAoOnly(ledger, ledgerStatus, packAoOnlyPending, readinessAoOnlyPending) {
  if (ledgerStatus === 'ready') return false
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return packAoOnlyPending || readinessAoOnlyPending
  }

  const checks =
    ledger.checks && typeof ledger.checks === 'object' && !Array.isArray(ledger.checks) ? ledger.checks : null
  if (!checks) {
    return packAoOnlyPending || readinessAoOnlyPending
  }

  const failingChecks = ['packReady', 'readinessReady', 'drillCheckOk', 'manifestValidated', 'aoGateValidated'].filter(
    (key) => checks[key] === false,
  )
  if (failingChecks.length === 0) {
    return false
  }

  const aoOnlyFailingChecks = failingChecks.every((key) => key === 'packReady' || key === 'readinessReady')
  if (!aoOnlyFailingChecks) {
    return false
  }

  const prerequisitesOk =
    checks.drillCheckOk !== false && checks.manifestValidated !== false && checks.aoGateValidated !== false
  return prerequisitesOk && (packAoOnlyPending || readinessAoOnlyPending)
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
  const warnings = []
  const automationBlockers = []
  const automationWarnings = []
  const aoManualBlockers = []
  const resolvedDir = resolve(dir)
  const resolvedGate = resolve(aoGateFile)

  const artifacts = {}
  for (const requirement of REQUIRED_ARTIFACTS) {
    const artifact = readJsonArtifact(resolvedDir, requirement, automationBlockers)
    artifacts[requirement.key] = artifact
    if (artifact.usedAlias) {
      automationWarnings.push(`using legacy artifact name ${artifact.actualFile} for ${artifact.file}`)
    }
  }

  const gateArtifact = readJsonArtifact('.', { file: resolvedGate, aliases: [] }, aoManualBlockers)
  const gate = gateArtifact.valid ? gateArtifact.value : null
  const gateSummary = collectGateChecks(gate, aoManualBlockers)

  const pack = artifacts['release-evidence-pack'].value
  const readiness = artifacts['release-readiness'].value
  const coreEvidence = artifacts['legacy-core-extraction-evidence'].value
  const cryptoEvidence = artifacts['legacy-crypto-boundary-evidence'].value
  const templateWorkerMapCoherence = artifacts['template-worker-map-coherence'].value
  const forgetForwardConfig = artifacts['forget-forward-config'].value
  const templateSignatureRefMap = artifacts['template-signature-ref-map'].value
  const templateVariantMap = artifacts['template-variant-map'].value
  const drillChecks = artifacts['release-drill-checks'].value
  const manifest = artifacts['release-drill-manifest'].value
  const drillCheck = artifacts['release-drill-check'].value
  const ledger = artifacts['release-evidence-ledger'].value
  const packSignals = collectEvidenceStatusSignals(pack)
  const readinessSignals = collectEvidenceStatusSignals(readiness)

  const packStatus = normalizeStatus(pack?.status)
  const readinessStatus = normalizeStatus(readiness?.status)
  const coreEvidenceStatus = normalizeStatus(coreEvidence?.status)
  const cryptoEvidenceStatus = normalizeStatus(cryptoEvidence?.status)
  const templateWorkerMapCoherenceStatus = normalizeStatus(templateWorkerMapCoherence?.status)
  const forgetForwardConfigStatus = normalizeStatus(forgetForwardConfig?.status)
  const templateSignatureRefMapStatus = normalizeStatus(templateSignatureRefMap?.status)
  const templateVariantMapStatus = normalizeStatus(templateVariantMap?.status)
  const drillChecksRelease = isNonEmptyString(drillChecks?.release) ? drillChecks.release.trim() : ''
  const manifestStatus = normalizeStatus(manifest?.status)
  const ledgerStatus = normalizeStatus(ledger?.overallStatus || ledger?.status)
  const drillCheckOk = drillCheck?.ok === true
  const coreEvidenceOk = coreEvidence?.ok === true || coreEvidenceStatus === 'pass' || coreEvidenceStatus === 'ready'
  const cryptoEvidenceOk =
    cryptoEvidence?.ok === true || cryptoEvidenceStatus === 'pass' || cryptoEvidenceStatus === 'ready'
  const packAoOnlyPending = packSignals.aoOnlyBlocked || (packStatus === 'warning' && packSignals.aoOnlyWarning)
  const readinessAoOnlyPending =
    readinessSignals.aoOnlyBlocked ||
    (readinessStatus === 'warning' && readinessSignals.aoOnlyWarning) ||
    ((readinessStatus === 'blocked' || readinessStatus === 'warning') &&
      readinessSignals.blockers.length === 0 &&
      readinessSignals.warnings.length === 0 &&
      packAoOnlyPending)
  const manifestAoOnlyPending =
    (manifestStatus === 'warning' || manifestStatus === 'blocked' || manifestStatus === 'pending') &&
    (packAoOnlyPending || readinessAoOnlyPending)
  const ledgerAoOnlyPending = isLedgerBlockedByAoOnly(ledger, ledgerStatus, packAoOnlyPending, readinessAoOnlyPending)

  if (artifacts['release-evidence-pack'].present && packStatus !== 'ready') {
    if (packAoOnlyPending) {
      automationWarnings.push(
        `release-evidence-pack.json status is ${packStatus || 'missing'} (AO dependency gate pending)`,
      )
    } else {
      automationBlockers.push(`release-evidence-pack.json status is ${packStatus || 'missing'} (expected ready)`)
    }
  }
  if (artifacts['release-readiness'].present && readinessStatus !== 'ready') {
    if (readinessAoOnlyPending || packAoOnlyPending) {
      automationWarnings.push(`release-readiness.json status is ${readinessStatus || 'missing'} (AO pending context)`)
    } else {
      automationBlockers.push(`release-readiness.json status is ${readinessStatus || 'missing'} (expected ready)`)
    }
  }
  if (artifacts['legacy-core-extraction-evidence'].present && !coreEvidenceOk) {
    automationBlockers.push(
      `legacy-core-extraction-evidence.json status is ${coreEvidenceStatus || 'missing'} (expected pass/ready)`,
    )
  }
  if (artifacts['legacy-crypto-boundary-evidence'].present && !cryptoEvidenceOk) {
    automationBlockers.push(
      `legacy-crypto-boundary-evidence.json status is ${cryptoEvidenceStatus || 'missing'} (expected pass/ready)`,
    )
  }
  if (artifacts['template-worker-map-coherence'].present && templateWorkerMapCoherenceStatus === 'blocked') {
    automationBlockers.push('template-worker-map-coherence.json status is blocked')
  }
  if (artifacts['forget-forward-config'].present && forgetForwardConfigStatus === 'blocked') {
    automationBlockers.push('forget-forward-config.json status is blocked')
  }
  if (artifacts['template-signature-ref-map'].present && templateSignatureRefMapStatus === 'blocked') {
    automationBlockers.push('template-signature-ref-map.json status is blocked')
  }
  if (artifacts['template-variant-map'].present && templateVariantMapStatus === 'blocked') {
    automationBlockers.push('template-variant-map.json status is blocked')
  }
  if (artifacts['release-drill-checks'].present && !isNonEmptyString(drillChecks?.release)) {
    automationBlockers.push('release-drill-checks.json is missing release')
  }
  if (artifacts['release-drill-checks'].present && !isNonEmptyString(drillChecks?.profile)) {
    automationBlockers.push('release-drill-checks.json is missing profile')
  }
  if (artifacts['release-drill-checks'].present && !isNonEmptyString(drillChecks?.mode)) {
    automationBlockers.push('release-drill-checks.json is missing mode')
  }
  if (artifacts['release-drill-checks'].present && typeof drillChecks?.strict !== 'boolean') {
    automationBlockers.push('release-drill-checks.json is missing strict boolean')
  }
  if (artifacts['release-drill-manifest'].present && manifestStatus !== 'ready') {
    if (manifestAoOnlyPending) {
      automationWarnings.push(
        `release-drill-manifest.json status is ${manifestStatus || 'missing'} (derived from AO pending readiness)`,
      )
    } else {
      automationBlockers.push(`release-drill-manifest.json status is ${manifestStatus || 'missing'} (expected ready)`)
    }
  }
  if (artifacts['release-drill-check'].present && !drillCheckOk) {
    automationBlockers.push('release-drill-check.json is not ok')
  }
  if (artifacts['release-evidence-ledger'].present && ledgerStatus !== 'ready') {
    if (ledgerAoOnlyPending) {
      automationWarnings.push(
        `release-evidence-ledger.json status is ${ledgerStatus || 'missing'} (expected while AO checks stay open)`,
      )
    } else {
      automationBlockers.push(`release-evidence-ledger.json status is ${ledgerStatus || 'missing'} (expected ready)`)
    }
  }

  if (artifacts['release-drill-checks'].valid) {
    for (const entry of DRILL_CHECK_EMBEDDED_JSON_FIELDS) {
      const artifact = artifacts[entry.artifactKey]
      if (!artifact || !artifact.valid) continue
      if (!Object.hasOwn(drillChecks, entry.field)) {
        automationBlockers.push(`release-drill-checks.json is missing ${entry.field}`)
        continue
      }
      if (!isDeepStrictEqual(drillChecks[entry.field], artifact.value)) {
        automationBlockers.push(`release-drill-checks.json ${entry.field} does not match ${entry.file}`)
      }
    }
  }

  const releaseValues = uniqueStrings([
    pack?.release,
    readiness?.release,
    drillChecksRelease,
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
  warnings.push(...automationWarnings)

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
    warningCount: warnings.length,
    blockers,
    warnings,
    automationBlockers,
    automationWarnings,
    aoManualBlockers,
    checks: {
      automation: {
        status: automationState,
        blockerCount: automationBlockers.length,
        warningCount: automationWarnings.length,
        blockers: automationBlockers,
        warnings: automationWarnings,
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
        file: artifacts['release-evidence-pack'].actualFile,
        usedAlias: artifacts['release-evidence-pack'].usedAlias,
        status: packStatus,
        release: isNonEmptyString(pack?.release) ? pack.release.trim() : '',
      },
      releaseReadiness: {
        present: artifacts['release-readiness'].present,
        valid: artifacts['release-readiness'].valid,
        file: artifacts['release-readiness'].actualFile,
        usedAlias: artifacts['release-readiness'].usedAlias,
        status: readinessStatus,
        blockerCount: Number.isInteger(readiness?.blockerCount) ? readiness.blockerCount : null,
        warningCount: Number.isInteger(readiness?.warningCount) ? readiness.warningCount : null,
        release: isNonEmptyString(readiness?.release) ? readiness.release.trim() : '',
      },
      legacyCoreExtractionEvidence: {
        present: artifacts['legacy-core-extraction-evidence'].present,
        valid: artifacts['legacy-core-extraction-evidence'].valid,
        file: artifacts['legacy-core-extraction-evidence'].actualFile,
        usedAlias: artifacts['legacy-core-extraction-evidence'].usedAlias,
        status: coreEvidenceStatus,
        ok: coreEvidence?.ok === true,
      },
      legacyCryptoBoundaryEvidence: {
        present: artifacts['legacy-crypto-boundary-evidence'].present,
        valid: artifacts['legacy-crypto-boundary-evidence'].valid,
        file: artifacts['legacy-crypto-boundary-evidence'].actualFile,
        usedAlias: artifacts['legacy-crypto-boundary-evidence'].usedAlias,
        status: cryptoEvidenceStatus,
        ok: cryptoEvidence?.ok === true,
      },
      templateWorkerMapCoherence: {
        present: artifacts['template-worker-map-coherence'].present,
        valid: artifacts['template-worker-map-coherence'].valid,
        file: artifacts['template-worker-map-coherence'].actualFile,
        usedAlias: artifacts['template-worker-map-coherence'].usedAlias,
        status: templateWorkerMapCoherenceStatus,
        ok: templateWorkerMapCoherence?.ok === true,
      },
      forgetForwardConfig: {
        present: artifacts['forget-forward-config'].present,
        valid: artifacts['forget-forward-config'].valid,
        file: artifacts['forget-forward-config'].actualFile,
        usedAlias: artifacts['forget-forward-config'].usedAlias,
        status: forgetForwardConfigStatus,
        ok: forgetForwardConfig?.ok === true,
      },
      templateSignatureRefMap: {
        present: artifacts['template-signature-ref-map'].present,
        valid: artifacts['template-signature-ref-map'].valid,
        file: artifacts['template-signature-ref-map'].actualFile,
        usedAlias: artifacts['template-signature-ref-map'].usedAlias,
        status: templateSignatureRefMapStatus,
        ok: templateSignatureRefMap?.ok === true,
      },
      templateVariantMap: {
        present: artifacts['template-variant-map'].present,
        valid: artifacts['template-variant-map'].valid,
        file: artifacts['template-variant-map'].actualFile,
        usedAlias: artifacts['template-variant-map'].usedAlias,
        status: templateVariantMapStatus,
        ok: templateVariantMap?.ok === true,
      },
      releaseDrillChecks: {
        present: artifacts['release-drill-checks'].present,
        valid: artifacts['release-drill-checks'].valid,
        file: artifacts['release-drill-checks'].actualFile,
        usedAlias: artifacts['release-drill-checks'].usedAlias,
        release: drillChecksRelease,
        profile: isNonEmptyString(drillChecks?.profile) ? drillChecks.profile.trim() : '',
        mode: isNonEmptyString(drillChecks?.mode) ? drillChecks.mode.trim() : '',
        strict: typeof drillChecks?.strict === 'boolean' ? drillChecks.strict : null,
      },
      releaseDrillManifest: {
        present: artifacts['release-drill-manifest'].present,
        valid: artifacts['release-drill-manifest'].valid,
        file: artifacts['release-drill-manifest'].actualFile,
        usedAlias: artifacts['release-drill-manifest'].usedAlias,
        status: manifestStatus,
        artifactsCount: Array.isArray(manifest?.artifacts) ? manifest.artifacts.length : null,
        release: isNonEmptyString(manifest?.release) ? manifest.release.trim() : '',
      },
      releaseDrillCheck: {
        present: artifacts['release-drill-check'].present,
        valid: artifacts['release-drill-check'].valid,
        file: artifacts['release-drill-check'].actualFile,
        usedAlias: artifacts['release-drill-check'].usedAlias,
        ok: drillCheckOk,
        missingCount: Array.isArray(drillCheck?.missing) ? drillCheck.missing.length : null,
        issueCount: Array.isArray(drillCheck?.issues) ? drillCheck.issues.length : null,
      },
      releaseEvidenceLedger: {
        present: artifacts['release-evidence-ledger'].present,
        valid: artifacts['release-evidence-ledger'].valid,
        file: artifacts['release-evidence-ledger'].actualFile,
        usedAlias: artifacts['release-evidence-ledger'].usedAlias,
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
  lines.push(`- Warnings: ${summary.warningCount}`)
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
    `- legacy-core-extraction-evidence.json: ${summary.checks.legacyCoreExtractionEvidence.present ? 'present' : 'missing'} / ${summary.checks.legacyCoreExtractionEvidence.status || 'n/a'}`,
  )
  lines.push(
    `- legacy-crypto-boundary-evidence.json: ${summary.checks.legacyCryptoBoundaryEvidence.present ? 'present' : 'missing'} / ${summary.checks.legacyCryptoBoundaryEvidence.status || 'n/a'}`,
  )
  lines.push(
    `- template-worker-map-coherence.json: ${summary.checks.templateWorkerMapCoherence.present ? 'present' : 'missing'} / ${summary.checks.templateWorkerMapCoherence.status || 'n/a'}`,
  )
  lines.push(
    `- forget-forward-config.json: ${summary.checks.forgetForwardConfig.present ? 'present' : 'missing'} / ${summary.checks.forgetForwardConfig.status || 'n/a'}`,
  )
  lines.push(
    `- template-signature-ref-map.json: ${summary.checks.templateSignatureRefMap.present ? 'present' : 'missing'} / ${summary.checks.templateSignatureRefMap.status || 'n/a'}`,
  )
  lines.push(
    `- template-variant-map.json: ${summary.checks.templateVariantMap.present ? 'present' : 'missing'} / ${summary.checks.templateVariantMap.status || 'n/a'}`,
  )
  lines.push(`- release-drill-checks.json: ${summary.checks.releaseDrillChecks.present ? 'present' : 'missing'}`)
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

  if (summary.warnings.length > 0) {
    lines.push('## Warnings')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
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
