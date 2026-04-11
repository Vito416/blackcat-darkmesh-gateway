#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_PROOF_DEFINITIONS = [
  { key: 'recoveryDrillLink', label: 'Recovery drill proof' },
  { key: 'aoFallbackLink', label: 'AO fallback proof' },
  { key: 'rollbackProofLink', label: 'Rollback proof' },
  { key: 'approvalsLink', label: 'Approvals / sign-off' },
]

const REQUIRED_PROOF_KEYS = REQUIRED_PROOF_DEFINITIONS.map((item) => item.key)

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
    '  node scripts/check-decommission-manual-proofs.js --file <DECOMMISSION_LOG_JSON> [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --file <DECOMMISSION_LOG_JSON>   Decommission evidence log JSON file (required)',
    '  --json                           Print structured JSON only',
    '  --strict                         Exit 3 when manual proofs are missing',
    '  --help                           Show this help',
    '',
    'Exit codes:',
    '  0   check completed (or pending without --strict)',
    '  3   strict mode failure or invalid log content',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeTrimmed(value) {
  return isNonEmptyString(value) ? value.trim() : ''
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
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.file)) throw new CliError('--file is required', 64)
  return args
}

function readJson(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new CliError(`unable to read file: ${err instanceof Error ? err.message : String(err)}`, 3)
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    throw new CliError(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`, 3)
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assessManualProofs(log) {
  const blockers = []
  const warnings = []

  if (!isObject(log)) {
    blockers.push('decommission log must be a JSON object')
    return {
      status: 'blocked',
      requiredCount: REQUIRED_PROOF_KEYS.length,
      providedCount: 0,
      missingCount: REQUIRED_PROOF_KEYS.length,
      missingProofKeys: [...REQUIRED_PROOF_KEYS],
      missingProofLabels: [...REQUIRED_PROOF_KEYS],
      blockers,
      warnings,
      proofs: [],
    }
  }

  const proofs = Array.isArray(log.manualProofs) ? log.manualProofs : []
  const byKey = new Map()
  for (const proof of proofs) {
    if (!isObject(proof) || !isNonEmptyString(proof.key)) continue
    byKey.set(proof.key.trim(), {
      key: proof.key.trim(),
      label: normalizeTrimmed(proof.label) || proof.key.trim(),
      link: normalizeTrimmed(proof.link),
    })
  }

  const normalizedProofs = []
  const missingProofKeys = []
  const missingProofLabels = []
  let providedCount = 0

  for (const definition of REQUIRED_PROOF_DEFINITIONS) {
    const proof = byKey.get(definition.key) || { key: definition.key, label: definition.label, link: '' }
    if (isNonEmptyString(proof.link)) {
      providedCount += 1
    } else {
      missingProofKeys.push(definition.key)
      missingProofLabels.push(proof.label)
    }
    normalizedProofs.push(proof)
  }

  const status = missingProofKeys.length === 0 ? 'complete' : 'pending'
  if (status !== 'complete') {
    warnings.push(`missing manual proofs: ${missingProofLabels.join(', ')}`)
  }

  return {
    status,
    requiredCount: REQUIRED_PROOF_KEYS.length,
    providedCount,
    missingCount: missingProofKeys.length,
    missingProofKeys,
    missingProofLabels,
    blockers,
    warnings,
    proofs: normalizedProofs,
  }
}

function renderHuman(file, summary) {
  const lines = []
  lines.push('# Decommission Manual Proof Check')
  lines.push('')
  lines.push(`- File: \`${file}\``)
  lines.push(`- Status: \`${summary.status}\``)
  lines.push(`- Proofs present: ${summary.providedCount}/${summary.requiredCount}`)
  lines.push('')

  if (summary.missingCount > 0) {
    lines.push('## Missing manual proofs')
    for (const label of summary.missingProofLabels) {
      lines.push(`- ${label}`)
    }
    lines.push('')
  }

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
    if (args.help) {
      return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
    }

    const file = resolve(args.file)
    const log = readJson(file)
    const summary = assessManualProofs(log)
    const payload = {
      file,
      strict: args.strict,
      ...summary,
    }

    const shouldFail = payload.blockers.length > 0 || (args.strict && payload.status !== 'complete')

    return {
      exitCode: shouldFail ? 3 : 0,
      stdout: args.json ? `${JSON.stringify(payload, null, 2)}\n` : renderHuman(file, payload),
      stderr: '',
      summary: payload,
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

export { REQUIRED_PROOF_KEYS, assessManualProofs, parseArgs, runCli, usageText }
