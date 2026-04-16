#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const DECISIONS = new Set(['pending', 'go', 'no-go'])

const MANDATORY_MACHINE_ARTIFACTS = [
  'consistency-matrix.json',
  'consistency-drift-report.md',
  'consistency-drift-summary.json',
  'latest-evidence-bundle.json',
  'ao-dependency-gate.validation.txt',
  'release-evidence-pack.md',
  'release-evidence-pack.json',
  'release-signoff-checklist.md',
  'release-readiness.json',
  'release-drill-manifest.json',
  'release-drill-manifest.validation.txt',
  'release-drill-check.json',
]

const OPTIONAL_MACHINE_ARTIFACTS = ['release-evidence-ledger.md', 'release-evidence-ledger.json']

const MANUAL_PROOF_FIELDS = [
  { key: 'recoveryDrillLink', label: 'Recovery drill proof' },
  { key: 'aoFallbackLink', label: 'AO fallback proof' },
  { key: 'rollbackProofLink', label: 'Rollback proof' },
  { key: 'approvalsLink', label: 'Approvals / sign-off' },
]

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-decommission-evidence-log.js --dir <DRILL_DIR> [--operator <NAME>] [--ticket <ID>] [--decision pending|go|no-go] [--notes <TEXT>] [--recovery-drill-link <URL>] [--ao-fallback-link <URL>] [--rollback-proof-link <URL>] [--approvals-link <URL>] [--strict] [--help]',
      '',
      'Options:',
      '  --dir <DRILL_DIR>          Drill artifact directory (required)',
      '  --operator <NAME>          Operator name in the log (default: env RELEASE_DRILL_OPERATOR/GITHUB_ACTOR/USER)',
      '  --ticket <ID>              Change/ticket reference for the decommission run',
      '  --decision <VALUE>         pending|go|no-go (default: pending)',
      '  --notes <TEXT>             Short manual notes for the log',
      '  --recovery-drill-link <U>  Link to the recovery drill proof',
      '  --ao-fallback-link <U>     Link to the AO fallback proof',
      '  --rollback-proof-link <U>   Link to the rollback proof',
      '  --approvals-link <U>       Link to the stakeholder approvals/sign-off',
      '  --strict                   Exit 3 if mandatory machine artifacts are missing',
      '  --help                     Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   strict failure or data error',
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

function normalizeTrimmed(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function normalizeOperator(operator) {
  const envValue =
    process.env.RELEASE_DRILL_OPERATOR ||
    process.env.GITHUB_ACTOR ||
    process.env.USER ||
    process.env.USERNAME ||
    'unknown'
  const picked = isNonEmptyString(operator) ? operator.trim() : envValue
  return isNonEmptyString(picked) ? picked : 'unknown'
}

function normalizeDecision(value) {
  const normalized = isNonEmptyString(value) ? value.trim().toLowerCase() : 'pending'
  if (!DECISIONS.has(normalized)) {
    throw new Error(`unsupported decision value: ${normalized}`)
  }
  return normalized
}

function normalizePath(value) {
  return value.split(/[\\/]+/).join('/')
}

function asRelativePath(root, absolutePath) {
  return normalizePath(relative(root, absolutePath))
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '')
}

function pickManualLinks(args) {
  return MANUAL_PROOF_FIELDS.map(({ key, label }) => ({
    key,
    label,
    link: normalizeTrimmed(args[key]),
  }))
}

function parseArgs(argv) {
  const args = {
    dir: '',
    operator: '',
    ticket: '',
    decision: 'pending',
    notes: '',
    out: '',
    jsonOut: '',
    strict: false,
    recoveryDrillLink: '',
    aoFallbackLink: '',
    rollbackProofLink: '',
    approvalsLink: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--strict') {
      args.strict = true
      continue
    }

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) {
        die(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--dir':
        args.dir = readValue()
        break
      case '--operator':
        args.operator = readValue()
        break
      case '--ticket':
        args.ticket = readValue()
        break
      case '--decision':
        args.decision = normalizeDecision(readValue())
        break
      case '--notes':
        args.notes = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      case '--recovery-drill-link':
        args.recoveryDrillLink = readValue()
        break
      case '--ao-fallback-link':
        args.aoFallbackLink = readValue()
        break
      case '--rollback-proof-link':
        args.rollbackProofLink = readValue()
        break
      case '--approvals-link':
        args.approvalsLink = readValue()
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) die('--dir is required', 64)
  return args
}

async function readJson(path, label) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new Error(`unable to read ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function safeReadJson(path, label, notes = []) {
  try {
    return await readJson(path, label)
  } catch (err) {
    if (Array.isArray(notes)) {
      notes.push(err instanceof Error ? err.message : String(err))
    }
    return null
  }
}

async function readArtifactRecord(drillDir, name, required = true) {
  const artifactPath = join(drillDir, name)
  try {
    const info = await stat(artifactPath)
    if (!info.isFile()) {
      return {
        name,
        required,
        present: false,
        path: asRelativePath(drillDir, artifactPath),
        sizeBytes: 0,
        sha256: '',
      }
    }
    const content = await readFile(artifactPath)
    return {
      name,
      required,
      present: true,
      path: asRelativePath(drillDir, artifactPath),
      sizeBytes: info.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
  } catch (_) {
    return {
      name,
      required,
      present: false,
      path: asRelativePath(drillDir, artifactPath),
      sizeBytes: 0,
      sha256: '',
    }
  }
}

function buildPresenceSummary(artifacts) {
  const requiredArtifacts = artifacts.filter((artifact) => artifact.required)
  const optionalArtifacts = artifacts.filter((artifact) => !artifact.required)
  const missingMandatoryArtifacts = requiredArtifacts.filter((artifact) => !artifact.present).map((artifact) => artifact.name)
  const presentMandatoryCount = requiredArtifacts.length - missingMandatoryArtifacts.length

  return {
    requiredCount: requiredArtifacts.length,
    requiredPresentCount: presentMandatoryCount,
    requiredMissingCount: missingMandatoryArtifacts.length,
    optionalCount: optionalArtifacts.length,
    optionalPresentCount: optionalArtifacts.filter((artifact) => artifact.present).length,
    missingMandatoryArtifacts,
    complete: missingMandatoryArtifacts.length === 0,
  }
}

function deriveRelease(readiness, pack) {
  const readinessRelease = readiness && typeof readiness === 'object' && !Array.isArray(readiness) ? normalizeTrimmed(readiness.release) : ''
  const packRelease = pack && typeof pack === 'object' && !Array.isArray(pack) ? normalizeTrimmed(pack.release) : ''
  return readinessRelease || packRelease || 'unknown'
}

function renderMarkdown(log) {
  const lines = []
  lines.push('# Decommission Evidence Log')
  lines.push('')
  lines.push(`- Created (UTC): \`${log.createdAtUtc}\``)
  lines.push(`- Operator: \`${log.operator}\``)
  lines.push(`- Ticket: \`${log.ticket || 'n/a'}\``)
  lines.push(`- Decision: \`${log.decision}\``)
  lines.push(`- Release: \`${log.release}\``)
  lines.push(`- Status: \`${log.status}\``)
  lines.push('')

  lines.push('## Artifact Presence Summary')
  lines.push(`- Required machine artifacts: ${log.presence.requiredCount}`)
  lines.push(`- Required artifacts present: ${log.presence.requiredPresentCount}`)
  lines.push(`- Required artifacts missing: ${log.presence.requiredMissingCount}`)
  lines.push(`- Optional artifacts present: ${log.presence.optionalPresentCount}/${log.presence.optionalCount}`)
  if (log.presence.missingMandatoryArtifacts.length > 0) {
    lines.push(`- Missing mandatory artifacts: ${log.presence.missingMandatoryArtifacts.map((name) => `\`${name}\``).join(', ')}`)
  }
  lines.push('')

  lines.push('## Machine Artifacts')
  lines.push('| Artifact | Required | Present | Size (bytes) | SHA-256 | Path |')
  lines.push('| --- | --- | --- | ---: | --- | --- |')
  for (const artifact of log.artifacts) {
    lines.push(
      `| ${artifact.name} | ${artifact.required ? 'yes' : 'no'} | ${artifact.present ? 'yes' : 'no'} | ${artifact.sizeBytes} | ${artifact.sha256 ? `\`${artifact.sha256}\`` : '-'} | \`${artifact.path}\` |`,
    )
  }
  lines.push('')

  lines.push('## Manual Proof Links')
  lines.push('| Proof | Link |')
  lines.push('| --- | --- |')
  for (const proof of log.manualProofs) {
    lines.push(`| ${proof.label} | ${proof.link ? proof.link : '-'} |`)
  }
  lines.push('')

  lines.push('## Notes')
  if (log.notes.length === 0) {
    lines.push('- None')
  } else {
    for (const note of log.notes) lines.push(`- ${note}`)
  }
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function writeText(path, content) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function buildDecommissionLog(args) {
  const drillDir = resolve(args.dir)
  const machineArtifacts = []
  for (const name of MANDATORY_MACHINE_ARTIFACTS) {
    machineArtifacts.push(await readArtifactRecord(drillDir, name, true))
  }
  for (const name of OPTIONAL_MACHINE_ARTIFACTS) {
    machineArtifacts.push(await readArtifactRecord(drillDir, name, false))
  }

  const presence = buildPresenceSummary(machineArtifacts)
  const parseNotes = []
  const pack = await safeReadJson(join(drillDir, 'release-evidence-pack.json'), 'release-evidence-pack.json', parseNotes)
  const readiness = await safeReadJson(join(drillDir, 'release-readiness.json'), 'release-readiness.json', parseNotes)
  const release = deriveRelease(readiness, pack)
  const notes = []

  if (isNonEmptyString(args.notes)) notes.push(args.notes.trim())
  for (const note of parseNotes) notes.push(note)
  if (presence.missingMandatoryArtifacts.length > 0) {
    notes.push(`Missing mandatory machine artifacts: ${presence.missingMandatoryArtifacts.join(', ')}`)
  }
  if (pack && typeof pack === 'object' && !Array.isArray(pack) && isNonEmptyString(pack.status)) {
    notes.push(`Release pack status: ${normalizeTrimmed(pack.status)}`)
  }
  if (readiness && typeof readiness === 'object' && !Array.isArray(readiness) && isNonEmptyString(readiness.status)) {
    notes.push(`Readiness status: ${normalizeTrimmed(readiness.status)}`)
  }

  return {
    createdAtUtc: new Date().toISOString(),
    dir: drillDir,
    operator: normalizeOperator(args.operator),
    ticket: normalizeTrimmed(args.ticket),
    decision: args.decision,
    release,
    status: presence.complete ? 'complete' : 'blocked',
    presence,
    artifacts: machineArtifacts,
    manualProofs: pickManualLinks(args),
    notes,
  }
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const log = await buildDecommissionLog(args)
  const markdown = renderMarkdown(log)

  const outPath = isNonEmptyString(args.out)
    ? resolve(args.out)
    : join(resolve(args.dir), 'decommission-evidence-log.md')
  const jsonOutPath = isNonEmptyString(args.jsonOut)
    ? resolve(args.jsonOut)
    : join(resolve(args.dir), 'decommission-evidence-log.json')
  await writeText(outPath, markdown)
  await writeText(jsonOutPath, `${JSON.stringify(log, null, 2)}\n`)

  process.stdout.write(markdown)

  if (args.strict && !log.presence.complete) {
    process.exit(3)
  }

  return log
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
  DECISIONS,
  MANDATORY_MACHINE_ARTIFACTS,
  OPTIONAL_MACHINE_ARTIFACTS,
  buildDecommissionLog,
  parseArgs,
  renderMarkdown,
  runCli,
}
