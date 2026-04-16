#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
    '  node scripts/validate-decommission-closeout.js --file <FILE> [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --file <FILE>   Closeout JSON artifact to validate (required)',
    '  --json          Print structured JSON only',
    '  --strict        Fail when closeout is not ready',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   validation passed or non-strict pending state',
    '  3   malformed payload or strict-mode readiness failure',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeText(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isArray(value) {
  return Array.isArray(value)
}

function isIntegerLike(value) {
  return Number.isInteger(value) && value >= 0
}

function parseArgs(argv) {
  const args = {
    file: '',
    json: false,
    strict: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }
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
      case '--file':
        args.file = readValue()
        break
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.file)) {
    throw new CliError('--file is required', 64)
  }

  return args
}

function readJsonFile(filePath) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (err) {
    throw new CliError(`unable to read file: ${err instanceof Error ? err.message : String(err)}`, 3)
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    throw new CliError(`invalid JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`, 3)
  }
}

function collectArrayIssues(fieldName, value, issues, { required = false } = {}) {
  if (typeof value === 'undefined') {
    if (required) {
      issues.push({ field: fieldName, message: `missing required field: ${fieldName}`, severity: 'error' })
    }
    return false
  }

  if (!isArray(value)) {
    issues.push({ field: fieldName, message: `field must be an array: ${fieldName}`, severity: 'error' })
    return false
  }

  return true
}

function validateManualProofs(value, issues) {
  if (typeof value === 'undefined') {
    return null
  }
  if (!isObject(value)) {
    issues.push({ field: 'validations.manualProofs', message: 'manualProofs must be an object', severity: 'error' })
    return null
  }

  const manualProofIssues = []
  const proofFields = ['status', 'requiredCount', 'providedCount', 'missingCount', 'missingProofKeys', 'missingProofLabels', 'blockers', 'warnings', 'proofs']
  for (const field of proofFields) {
    if (typeof value[field] === 'undefined') {
      manualProofIssues.push({ field: `validations.manualProofs.${field}`, message: `missing required field: ${field}`, severity: 'error' })
    }
  }

  const status = normalizeText(value.status).toLowerCase()
  if (isNonEmptyString(value.status) && !['complete', 'pending', 'blocked'].includes(status)) {
    manualProofIssues.push({ field: 'validations.manualProofs.status', message: `invalid manualProofs status: ${value.status}`, severity: 'error' })
  }

  for (const countField of ['requiredCount', 'providedCount', 'missingCount']) {
    if (typeof value[countField] !== 'undefined' && !isIntegerLike(value[countField])) {
      manualProofIssues.push({ field: `validations.manualProofs.${countField}`, message: `${countField} must be a non-negative integer`, severity: 'error' })
    }
  }

  for (const arrayField of ['missingProofKeys', 'missingProofLabels', 'blockers', 'warnings', 'proofs']) {
    if (typeof value[arrayField] !== 'undefined' && !isArray(value[arrayField])) {
      manualProofIssues.push({ field: `validations.manualProofs.${arrayField}`, message: `${arrayField} must be an array`, severity: 'error' })
    }
  }

  if (isArray(value.proofs)) {
    for (let index = 0; index < value.proofs.length; index += 1) {
      const proof = value.proofs[index]
      if (!isObject(proof)) {
        manualProofIssues.push({ field: `validations.manualProofs.proofs[${index}]`, message: 'proof entry must be an object', severity: 'error' })
        continue
      }
      for (const field of ['key', 'label', 'link']) {
        if (!isNonEmptyString(proof[field])) {
          manualProofIssues.push({ field: `validations.manualProofs.proofs[${index}].${field}`, message: `missing required field: ${field}`, severity: 'error' })
        }
      }
    }
  }

  issues.push(...manualProofIssues)
  return {
    status: normalizeText(value.status),
    requiredCount: value.requiredCount,
    providedCount: value.providedCount,
    missingCount: value.missingCount,
    missingProofKeys: isArray(value.missingProofKeys) ? value.missingProofKeys : [],
    missingProofLabels: isArray(value.missingProofLabels) ? value.missingProofLabels : [],
    blockers: isArray(value.blockers) ? value.blockers : [],
    warnings: isArray(value.warnings) ? value.warnings : [],
    proofs: isArray(value.proofs) ? value.proofs : [],
  }
}

function inspectStateField(payload, fieldName, issues, { required = true } = {}) {
  if (typeof payload[fieldName] === 'undefined') {
    if (required) {
      issues.push({ field: fieldName, message: `missing required field: ${fieldName}`, severity: 'error' })
    }
    return ''
  }
  if (!isNonEmptyString(payload[fieldName])) {
    issues.push({ field: fieldName, message: `field must be a non-empty string: ${fieldName}`, severity: 'error' })
    return ''
  }
  return normalizeText(payload[fieldName])
}

function inspectSteps(payload, issues) {
  if (!collectArrayIssues('steps', payload.steps, issues, { required: true })) {
    return []
  }

  const steps = []
  for (let index = 0; index < payload.steps.length; index += 1) {
    const step = payload.steps[index]
    if (!isObject(step)) {
      issues.push({ field: `steps[${index}]`, message: 'step entry must be an object', severity: 'error' })
      continue
    }

    const id = normalizeText(step.id)
    const label = normalizeText(step.label)
    const status = normalizeText(step.status)
    if (!isNonEmptyString(id)) {
      issues.push({ field: `steps[${index}].id`, message: 'missing required field: id', severity: 'error' })
    }
    if (!isNonEmptyString(label)) {
      issues.push({ field: `steps[${index}].label`, message: 'missing required field: label', severity: 'error' })
    }
    if (!isNonEmptyString(status)) {
      issues.push({ field: `steps[${index}].status`, message: 'missing required field: status', severity: 'error' })
    }
    if (typeof step.exitCode !== 'undefined' && !Number.isInteger(step.exitCode)) {
      issues.push({ field: `steps[${index}].exitCode`, message: 'exitCode must be an integer when present', severity: 'error' })
    }

    steps.push({ ...step, id, label, status })
  }

  return steps
}

function evaluateCloseout(payload) {
  const issues = []
  const warnings = []
  const blockers = []

  if (!isObject(payload)) {
    issues.push({ field: 'document', message: 'payload must be a JSON object', severity: 'error' })
    return {
      malformed: true,
      ready: false,
      evaluationStatus: 'invalid',
      issueCount: issues.length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      issues,
      blockers,
      warnings,
      steps: [],
      validations: { manualProofs: null },
      artifactStatus: '',
      closeoutState: '',
      automationState: '',
      aoManualState: '',
    }
  }

  const artifactStatus = inspectStateField(payload, 'status', issues)
  const closeoutState = inspectStateField(payload, 'closeoutState', issues)
  const automationState = inspectStateField(payload, 'automationState', issues)
  const aoManualState = inspectStateField(payload, 'aoManualState', issues)
  const steps = inspectSteps(payload, issues)

  const validations = isObject(payload.validations) ? payload.validations : null
  if (typeof payload.validations !== 'undefined' && !isObject(payload.validations)) {
    issues.push({ field: 'validations', message: 'validations must be an object when present', severity: 'error' })
  }

  const manualProofs = validations ? validateManualProofs(validations.manualProofs, issues) : null
  const validationsOut = { manualProofs }

  const rawBlockers = []
  for (const fieldName of ['blockers', 'automationBlockers', 'aoManualBlockers', 'warnings']) {
    const value = payload[fieldName]
    if (typeof value === 'undefined') continue
    if (!isArray(value)) {
      issues.push({ field: fieldName, message: `field must be an array when present: ${fieldName}`, severity: 'error' })
      continue
    }
    if (fieldName !== 'warnings') {
      rawBlockers.push(...value.filter((item) => isNonEmptyString(item)).map((item) => normalizeText(item)))
    } else {
      warnings.push(...value.filter((item) => isNonEmptyString(item)).map((item) => normalizeText(item)))
    }
  }

  if (manualProofs) {
    if (isArray(manualProofs.blockers)) {
      rawBlockers.push(...manualProofs.blockers.filter((item) => isNonEmptyString(item)).map((item) => `manualProofs: ${normalizeText(item)}`))
    }
    if (isArray(manualProofs.warnings)) {
      warnings.push(...manualProofs.warnings.filter((item) => isNonEmptyString(item)).map((item) => `manualProofs: ${normalizeText(item)}`))
    }
  }

  const normalized = {
    artifactStatus: artifactStatus.toLowerCase(),
    closeoutState: closeoutState.toLowerCase(),
    automationState: automationState.toLowerCase(),
    aoManualState: aoManualState.toLowerCase(),
  }

  if (normalized.artifactStatus && normalized.artifactStatus !== 'ready') {
    warnings.push(`closeout artifact status is ${normalized.artifactStatus}`)
  }
  if (normalized.closeoutState && normalized.closeoutState !== 'ready') {
    warnings.push(`closeout state is ${normalized.closeoutState}`)
  }
  if (normalized.automationState && normalized.automationState !== 'complete') {
    warnings.push(`automation state is ${normalized.automationState}`)
  }
  if (normalized.aoManualState && normalized.aoManualState !== 'complete') {
    warnings.push(`ao/manual state is ${normalized.aoManualState}`)
  }

  blockers.push(...rawBlockers)

  const ready =
    normalized.artifactStatus === 'ready' &&
    normalized.closeoutState === 'ready' &&
    normalized.automationState === 'complete' &&
    normalized.aoManualState === 'complete' &&
    blockers.length === 0 &&
    issues.length === 0

  const evaluationStatus = issues.length > 0
    ? 'invalid'
    : ready
    ? 'ready'
    : blockers.length > 0 || normalized.closeoutState.includes('blocked') || normalized.automationState === 'blocked' || normalized.aoManualState === 'blocked' || normalized.artifactStatus === 'blocked'
      ? 'blocked'
      : 'pending'

  return {
    malformed: issues.length > 0,
    ready,
    evaluationStatus,
    issueCount: issues.length,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    issues,
    blockers,
    warnings,
    steps,
    validations: validationsOut,
    artifactStatus: artifactStatus,
    closeoutState: closeoutState,
    automationState: automationState,
    aoManualState: aoManualState,
  }
}

function renderHuman(filePath, result) {
  if (result.malformed) {
    return [
      'invalid decommission closeout:',
      `- File: \`${filePath}\``,
      `- Status: \`${result.evaluationStatus}\``,
      `- Closeout state: \`${result.closeoutState || 'n/a'}\``,
      `- Automation state: \`${result.automationState || 'n/a'}\``,
      `- AO/manual state: \`${result.aoManualState || 'n/a'}\``,
      '',
      '## Issues',
      ...result.issues.map((issue) => `- ${issue.message}${issue.field ? ` [${issue.field}]` : ''}`),
      '',
    ].join('\n')
  }

  const lines = []
  lines.push('# Decommission Closeout Validation')
  lines.push('')
  lines.push(`- File: \`${filePath}\``)
  lines.push(`- Status: \`${result.evaluationStatus}\``)
  lines.push(`- Artifact status: \`${result.artifactStatus || 'n/a'}\``)
  lines.push(`- Closeout state: \`${result.closeoutState || 'n/a'}\``)
  lines.push(`- Automation state: \`${result.automationState || 'n/a'}\``)
  lines.push(`- AO/manual state: \`${result.aoManualState || 'n/a'}\``)
  lines.push(`- Ready: ${result.ready ? 'yes' : 'no'}`)
  lines.push(`- Steps: ${result.steps.length}`)
  lines.push('')

  if (result.warnings.length > 0) {
    lines.push('## Warnings')
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`)
    }
    lines.push('')
  }

  if (result.blockers.length > 0) {
    lines.push('## Blockers')
    for (const blocker of result.blockers) {
      lines.push(`- ${blocker}`)
    }
    lines.push('')
  }

  if (result.validations.manualProofs) {
    lines.push('## Manual proofs')
    lines.push(`- Status: \`${result.validations.manualProofs.status || 'n/a'}\``)
    lines.push(`- Proofs: ${result.validations.manualProofs.providedCount || 0}/${result.validations.manualProofs.requiredCount || 0}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function validateDecommissionCloseout(payload) {
  const result = evaluateCloseout(payload)
  return {
    ok: result.ready && !result.malformed,
    ...result,
  }
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
    }

    const file = resolve(args.file)
    const payload = readJsonFile(file)
    const result = validateDecommissionCloseout(payload)
    const exitCode = result.malformed || (args.strict && !result.ready) ? 3 : 0

    const rendered = args.json
      ? `${JSON.stringify(
          {
            file,
            strict: args.strict,
            ok: result.ok,
            status: result.evaluationStatus,
            artifactStatus: result.artifactStatus,
            closeoutState: result.closeoutState,
            automationState: result.automationState,
            aoManualState: result.aoManualState,
            ready: result.ready,
            malformed: result.malformed,
            issueCount: result.issueCount,
            blockerCount: result.blockerCount,
            warningCount: result.warningCount,
            issues: result.issues,
            blockers: result.blockers,
            warnings: result.warnings,
            steps: result.steps,
            validations: result.validations,
          },
          null,
          2,
        )}\n`
      : renderHuman(file, result)

    return { exitCode, stdout: rendered, stderr: '', summary: result }
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: `${usageText()}\n`, stderr: `error: ${err.message}\n` }
    }
    return { exitCode: 3, stdout: '', stderr: `error: ${err instanceof Error ? err.message : String(err)}\n` }
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === entryPoint) {
  const result = runCli()
  process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

export {
  validateDecommissionCloseout,
  runCli,
}
