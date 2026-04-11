#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VALID_PROFILES = new Set(['wedos_small', 'wedos_medium', 'diskless'])
const VALID_DECISIONS = new Set(['pending', 'go', 'no-go'])

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

const STEP_SCRIPTS = {
  checkAoGateEvidence: resolve(SCRIPT_DIR, 'check-ao-gate-evidence.js'),
  checkDecommissionReadiness: resolve(SCRIPT_DIR, 'check-decommission-readiness.js'),
  validateWedosReadiness: resolve(SCRIPT_DIR, 'validate-wedos-readiness.js'),
  buildDecommissionEvidenceLog: resolve(SCRIPT_DIR, 'build-decommission-evidence-log.js'),
}

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeTrimmed(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/run-decommission-closeout.js --dir <DRILL_DIR> --ao-gate <FILE> [--profile wedos_small|wedos_medium|diskless] [--env-file <FILE>] [--operator <NAME>] [--ticket <ID>] [--decision pending|go|no-go] [--notes <TEXT>] [--recovery-drill-link <URL>] [--ao-fallback-link <URL>] [--rollback-proof-link <URL>] [--approvals-link <URL>] [--json] [--strict] [--dry-run] [--help]',
    '',
    'Options:',
    '  --dir <DRILL_DIR>          Drill artifact directory (required)',
    '  --ao-gate <FILE>           AO dependency gate JSON file (required)',
    '  --profile <NAME>           Optional WEDOS profile to validate',
    '  --env-file <FILE>          Optional dotenv-style env file for WEDOS validation',
    '  --operator <NAME>          Operator name for the evidence log',
    '  --ticket <ID>              Change/ticket reference for the evidence log',
    '  --decision <VALUE>         pending|go|no-go (default: pending)',
    '  --notes <TEXT>             Short manual notes for the evidence log',
    '  --recovery-drill-link <U>  Link to the recovery drill proof',
    '  --ao-fallback-link <U>     Link to the AO fallback proof',
    '  --rollback-proof-link <U>  Link to the rollback proof',
    '  --approvals-link <U>       Link to the stakeholder approvals/sign-off',
    '  --json                     Print machine-friendly JSON only',
    '  --strict                   Fail non-zero if any prerequisite fails or readiness is blocked',
    '  --dry-run                  Show the planned commands without running them',
    '  --help                     Show this help',
    '',
    'Sequence:',
    '  1) check AO gate evidence',
    '  2) check decommission readiness',
    '  3) optional WEDOS readiness validation',
    '  4) build decommission evidence log',
    '',
    'Exit codes:',
    '  0   success or dry run',
    '  3   blocked/failure in strict mode, or log build failure',
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

function parseArgs(argv) {
  const args = {
    dir: '',
    aoGate: '',
    profile: '',
    envFile: '',
    operator: '',
    ticket: '',
    decision: 'pending',
    notes: '',
    recoveryDrillLink: '',
    aoFallbackLink: '',
    rollbackProofLink: '',
    approvalsLink: '',
    strict: false,
    dryRun: false,
    json: false,
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
    if (arg === '--dry-run') {
      args.dryRun = true
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
      case '--profile':
        args.profile = readValue().trim().toLowerCase()
        break
      case '--env-file':
        args.envFile = readValue()
        break
      case '--operator':
        args.operator = readValue()
        break
      case '--ticket':
        args.ticket = readValue()
        break
      case '--decision':
        args.decision = readValue().trim().toLowerCase()
        break
      case '--notes':
        args.notes = readValue()
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
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir is required', 64)
  if (!isNonEmptyString(args.aoGate)) throw new CliError('--ao-gate is required', 64)
  if (isNonEmptyString(args.profile) && !VALID_PROFILES.has(args.profile)) {
    throw new CliError(`unsupported --profile value: ${args.profile}`, 64)
  }
  if (!VALID_DECISIONS.has(args.decision)) {
    throw new CliError(`unsupported --decision value: ${args.decision}`, 64)
  }

  return args
}

function quoteArg(value) {
  const text = String(value)
  if (text.length === 0) return '""'
  if (/^<.*>$/.test(text)) return text
  if (/^[A-Za-z0-9._:@/+=,-]+$/.test(text)) return text
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => quoteArg(arg))].join(' ')
}

function normalizeExitCode(result) {
  if (result && typeof result.status === 'number') return result.status
  if (result && (result.error || result.signal)) return 3
  return 3
}

function stepStatusFromResult(stepId, exitCode, parsed) {
  if (stepId === 'check-ao-gate-evidence') {
    const result = normalizeTrimmed(parsed?.result).toUpperCase()
    if (result === 'OK') return 'passed'
    if (result === 'WARNING') return 'warning'
    if (exitCode === 0 && parsed?.closeoutReady === true) return 'passed'
    if (exitCode === 0) return 'warning'
    return 'failed'
  }

  if (stepId === 'check-decommission-readiness') {
    const status = normalizeTrimmed(parsed?.status).toLowerCase()
    if (status === 'ready') return 'passed'
    if (status === 'blocked') return 'blocked'
    return exitCode === 0 ? 'blocked' : 'failed'
  }

  if (stepId === 'validate-wedos-readiness') {
    const status = normalizeTrimmed(parsed?.status).toLowerCase()
    if (status === 'pass') return 'passed'
    if (status === 'warn') return 'warning'
    if (status === 'fail') return 'failed'
    return exitCode === 0 ? 'passed' : 'failed'
  }

  if (stepId === 'build-decommission-evidence-log') {
    const status = normalizeTrimmed(parsed?.status).toLowerCase()
    if (status === 'complete') return 'passed'
    if (status === 'blocked') return 'blocked'
    return exitCode === 0 ? 'passed' : 'failed'
  }

  return exitCode === 0 ? 'passed' : 'failed'
}

function asRelativePath(path) {
  return relative(REPO_ROOT, path)
}

function buildCloseoutPlan(options = {}) {
  const dir = resolve(options.dir || '')
  const aoGateFile = resolve(options.aoGate || '')
  const profile = isNonEmptyString(options.profile) ? options.profile.trim().toLowerCase() : ''
  const envFile = isNonEmptyString(options.envFile) ? resolve(options.envFile) : ''
  const operator = normalizeTrimmed(options.operator)
  const ticket = normalizeTrimmed(options.ticket)
  const decision = isNonEmptyString(options.decision) ? options.decision.trim().toLowerCase() : 'pending'
  const notes = normalizeTrimmed(options.notes)
  const strict = options.strict === true
  const dryRun = options.dryRun === true
  const json = options.json === true

  const outDir = dir
  const decommissionEvidenceLogMd = join(outDir, 'decommission-evidence-log.md')
  const decommissionEvidenceLogJson = join(outDir, 'decommission-evidence-log.json')

  const steps = [
    {
      id: 'check-ao-gate-evidence',
      index: 1,
      label: 'check AO gate evidence',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkAoGateEvidence,
      displayScriptPath: asRelativePath(STEP_SCRIPTS.checkAoGateEvidence),
      args: () => ['--file', aoGateFile, '--json', ...(strict ? ['--strict'] : [])],
      displayArgs: ['--file', aoGateFile, '--json', ...(strict ? ['--strict'] : [])],
      parseJson: true,
    },
    {
      id: 'check-decommission-readiness',
      index: 2,
      label: 'check decommission readiness',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkDecommissionReadiness,
      displayScriptPath: asRelativePath(STEP_SCRIPTS.checkDecommissionReadiness),
      args: () => ['--dir', dir, '--ao-gate', aoGateFile, '--json', ...(strict ? ['--strict'] : [])],
      displayArgs: ['--dir', dir, '--ao-gate', aoGateFile, '--json', ...(strict ? ['--strict'] : [])],
      parseJson: true,
    },
    {
      id: 'validate-wedos-readiness',
      index: 3,
      label: profile ? `validate WEDOS readiness (${profile})` : 'validate WEDOS readiness',
      command: 'node',
      scriptPath: STEP_SCRIPTS.validateWedosReadiness,
      displayScriptPath: asRelativePath(STEP_SCRIPTS.validateWedosReadiness),
      args: () => {
        if (!profile) return []
        const next = ['--profile', profile, '--json']
        if (isNonEmptyString(envFile)) next.push('--env-file', envFile)
        if (strict) next.push('--strict')
        return next
      },
      displayArgs: () => {
        if (!profile) return []
        const next = ['--profile', profile, '--json']
        if (isNonEmptyString(envFile)) next.push('--env-file', envFile)
        if (strict) next.push('--strict')
        return next
      },
      parseJson: true,
      optional: true,
    },
    {
      id: 'build-decommission-evidence-log',
      index: 4,
      label: 'build decommission evidence log',
      command: 'node',
      scriptPath: STEP_SCRIPTS.buildDecommissionEvidenceLog,
      displayScriptPath: asRelativePath(STEP_SCRIPTS.buildDecommissionEvidenceLog),
      args: () => {
        const next = ['--dir', dir, '--decision', decision]
        if (isNonEmptyString(operator)) next.push('--operator', operator)
        if (isNonEmptyString(ticket)) next.push('--ticket', ticket)
        if (isNonEmptyString(notes)) next.push('--notes', notes)
        if (isNonEmptyString(options.recoveryDrillLink)) next.push('--recovery-drill-link', options.recoveryDrillLink)
        if (isNonEmptyString(options.aoFallbackLink)) next.push('--ao-fallback-link', options.aoFallbackLink)
        if (isNonEmptyString(options.rollbackProofLink)) next.push('--rollback-proof-link', options.rollbackProofLink)
        if (isNonEmptyString(options.approvalsLink)) next.push('--approvals-link', options.approvalsLink)
        if (strict) next.push('--strict')
        return next
      },
      displayArgs: () => {
        const next = ['--dir', dir, '--decision', decision]
        if (isNonEmptyString(operator)) next.push('--operator', operator)
        if (isNonEmptyString(ticket)) next.push('--ticket', ticket)
        if (isNonEmptyString(notes)) next.push('--notes', notes)
        if (isNonEmptyString(options.recoveryDrillLink)) next.push('--recovery-drill-link', options.recoveryDrillLink)
        if (isNonEmptyString(options.aoFallbackLink)) next.push('--ao-fallback-link', options.aoFallbackLink)
        if (isNonEmptyString(options.rollbackProofLink)) next.push('--rollback-proof-link', options.rollbackProofLink)
        if (isNonEmptyString(options.approvalsLink)) next.push('--approvals-link', options.approvalsLink)
        if (strict) next.push('--strict')
        return next
      },
      parseJson: false,
      outputFiles: [decommissionEvidenceLogMd, decommissionEvidenceLogJson],
    },
  ]

  const activeSteps = profile ? steps : [steps[0], steps[1], steps[3]]
  const plannedSteps = profile ? steps : steps.map((step) => (step.id === 'validate-wedos-readiness' ? { ...step, skipped: true } : step))

  return {
    createdAtUtc: new Date().toISOString(),
    dir,
    aoGateFile,
    profile,
    envFile,
    operator,
    ticket,
    decision,
    notes,
    strict,
    dryRun,
    json,
    outDir,
    artifacts: {
      decommissionEvidenceLogMd,
      decommissionEvidenceLogJson,
    },
    steps: plannedSteps,
    activeSteps,
  }
}

function formatDryRunPlan(plan) {
  const lines = []
  lines.push('# Decommission Closeout')
  lines.push('')
  lines.push(`- Dir: \`${plan.dir}\``)
  lines.push(`- AO gate: \`${plan.aoGateFile}\``)
  lines.push(`- Profile: \`${plan.profile || 'n/a'}\``)
  if (isNonEmptyString(plan.envFile)) lines.push(`- Env file: \`${plan.envFile}\``)
  if (isNonEmptyString(plan.operator)) lines.push(`- Operator: \`${plan.operator}\``)
  if (isNonEmptyString(plan.ticket)) lines.push(`- Ticket: \`${plan.ticket}\``)
  lines.push(`- Decision: \`${plan.decision}\``)
  lines.push(`- Strict: ${plan.strict ? 'yes' : 'no'}`)
  lines.push(`- Dry run: ${plan.dryRun ? 'yes' : 'no'}`)
  lines.push('')
  lines.push('## Planned steps')

  for (const step of plan.steps) {
    if (step.skipped) {
      lines.push(`- [${step.index}] ${step.label} (skipped: no profile provided)`)
      continue
    }

    const args = typeof step.displayArgs === 'function' ? step.displayArgs() : step.displayArgs
    lines.push(`- [${step.index}] ${step.label}`)
    lines.push(`  - ${formatCommand(step.command, [step.displayScriptPath, ...args])}`)
  }

  lines.push('')
  lines.push(`- Evidence log markdown: \`${plan.artifacts.decommissionEvidenceLogMd}\``)
  lines.push(`- Evidence log JSON: \`${plan.artifacts.decommissionEvidenceLogJson}\``)
  lines.push('')
  return `${lines.join('\n')}\n`
}

function spawnStep(step, stepArgs, deps = {}) {
  const spawnSyncFn = deps.spawnSyncFn ?? spawnSync
  return spawnSyncFn(process.execPath, [step.scriptPath, ...stepArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

function readJsonFile(path) {
  const text = readFileSync(path, 'utf8')
  return JSON.parse(text)
}

function reduceStepResult(step, spawnResult, plan) {
  const exitCode = normalizeExitCode(spawnResult)
  const stdout = typeof spawnResult?.stdout === 'string' ? spawnResult.stdout : ''
  const stderr = typeof spawnResult?.stderr === 'string' ? spawnResult.stderr : ''
  const result = {
    id: step.id,
    index: step.index,
    label: step.label,
    command: step.command,
    script: step.displayScriptPath,
    args: typeof step.displayArgs === 'function' ? step.displayArgs() : step.displayArgs,
    exitCode,
    status: 'failed',
    stdout,
    stderr,
  }

  let parsed = null
  if (step.parseJson) {
    try {
      parsed = JSON.parse(stdout || '{}')
      result.payload = parsed
    } catch (err) {
      result.parseError = err instanceof Error ? err.message : String(err)
    }
  }

  if (step.id === 'check-ao-gate-evidence') {
    if (parsed && Array.isArray(parsed.warnings) && parsed.warnings.length > 0) {
      result.warnings = parsed.warnings.slice()
    }
    if (parsed && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
      result.blockers = parsed.issues.slice()
    }
    result.status = stepStatusFromResult(step.id, exitCode, parsed)
  } else if (step.id === 'check-decommission-readiness') {
    if (parsed && Array.isArray(parsed.blockers) && parsed.blockers.length > 0) {
      result.blockers = parsed.blockers.slice()
    }
    result.status = stepStatusFromResult(step.id, exitCode, parsed)
  } else if (step.id === 'validate-wedos-readiness') {
    if (parsed && Array.isArray(parsed.issues)) {
      result.issues = parsed.issues.slice()
    }
    result.status = stepStatusFromResult(step.id, exitCode, parsed)
  } else if (step.id === 'build-decommission-evidence-log') {
    const logJsonPath = plan.artifacts.decommissionEvidenceLogJson
    if (existsSync(logJsonPath)) {
      try {
        const log = readJsonFile(logJsonPath)
        result.payload = {
          status: log.status,
          release: log.release,
          presence: log.presence,
          createdAtUtc: log.createdAtUtc,
        }
      } catch (err) {
        result.parseError = err instanceof Error ? err.message : String(err)
      }
    } else {
      result.parseError = `missing generated log JSON: ${logJsonPath}`
    }
    result.outputFiles = plan.steps.find((candidate) => candidate.id === step.id)?.outputFiles || [plan.artifacts.decommissionEvidenceLogMd, plan.artifacts.decommissionEvidenceLogJson]
    result.status = stepStatusFromResult(step.id, exitCode, result.payload)
  }

  if (result.parseError && result.status === 'passed') {
    result.status = 'failed'
  }

  return result
}

function runCloseout(options = {}, deps = {}) {
  const plan = buildCloseoutPlan(options)

  if (plan.dryRun) {
    const stdout = plan.json
      ? `${JSON.stringify(
          {
            createdAtUtc: plan.createdAtUtc,
            dir: plan.dir,
            aoGateFile: plan.aoGateFile,
            profile: plan.profile,
            envFile: plan.envFile,
            operator: plan.operator,
            ticket: plan.ticket,
            decision: plan.decision,
            notes: plan.notes,
            strict: plan.strict,
            dryRun: true,
            status: 'dry-run',
            exitCode: 0,
            steps: plan.steps.map((step) => ({
              id: step.id,
              index: step.index,
              label: step.label,
              command: step.command,
              script: step.displayScriptPath,
              args: typeof step.displayArgs === 'function' ? step.displayArgs() : step.displayArgs,
              status: step.skipped ? 'skipped' : 'planned',
            })),
            artifacts: plan.artifacts,
          },
          null,
          2,
        )}\n`
      : formatDryRunPlan(plan)

    return {
      exitCode: 0,
      stdout,
      stderr: '',
      plan,
      steps: plan.steps.map((step) => ({
        id: step.id,
        index: step.index,
        label: step.label,
        status: step.skipped ? 'skipped' : 'planned',
      })),
      status: 'dry-run',
      blockers: [],
      warnings: [],
    }
  }

  mkdirSync(plan.outDir, { recursive: true })

  const stepResults = []
  const blockers = []
  const warnings = []
  let readinessBlocked = false
  let logFailed = false
  const stdoutChunks = []
  const stderrChunks = []

  for (const step of plan.steps) {
    if (step.skipped) {
      stepResults.push({
        id: step.id,
        index: step.index,
        label: step.label,
        command: step.command,
        script: step.displayScriptPath,
        args: [],
        status: 'skipped',
      })
      continue
    }

    const args = typeof step.args === 'function' ? step.args({ plan }) : step.args
    const spawnResult = spawnStep(step, args, deps)
    const reduced = reduceStepResult(step, spawnResult, plan)

    if (!plan.json) {
      const stepLine = `[${step.index}/${plan.steps.length}] ${step.label}`
      stdoutChunks.push(`${stepLine}\n`)
      if (reduced.stdout) stdoutChunks.push(reduced.stdout.endsWith('\n') ? reduced.stdout : `${reduced.stdout}\n`)
      if (reduced.stderr) stderrChunks.push(reduced.stderr.endsWith('\n') ? reduced.stderr : `${reduced.stderr}\n`)
      stdoutChunks.push(`${stepLine} -> ${reduced.status} (exit ${reduced.exitCode})\n`)
    }

    if (step.id === 'check-ao-gate-evidence') {
      if (reduced.status !== 'passed') {
        readinessBlocked = true
        blockers.push(`AO gate evidence check is ${reduced.status}`)
      }
      if (Array.isArray(reduced.payload?.warnings) && reduced.payload.warnings.length > 0) {
        warnings.push(...reduced.payload.warnings.map((warning) => `AO gate: ${warning}`))
      }
    }

    if (step.id === 'check-decommission-readiness') {
      if (reduced.status !== 'passed') {
        readinessBlocked = true
        blockers.push('decommission readiness has blockers')
      }
      if (Array.isArray(reduced.payload?.blockers) && reduced.payload.blockers.length > 0) {
        blockers.push(...reduced.payload.blockers.map((item) => `readiness: ${item}`))
      }
    }

    if (step.id === 'validate-wedos-readiness') {
      if (reduced.status === 'failed') {
        readinessBlocked = true
        blockers.push('WEDOS readiness validation failed')
      }
      if (Array.isArray(reduced.payload?.issues)) {
        for (const issue of reduced.payload.issues) {
          if (issue && issue.severity === 'critical') {
            readinessBlocked = true
            blockers.push(`WEDOS: ${issue.message}`)
          } else if (issue && issue.severity === 'warning') {
            warnings.push(`WEDOS: ${issue.message}`)
          }
        }
      }
    }

    if (step.id === 'build-decommission-evidence-log') {
      const logJsonPath = plan.artifacts.decommissionEvidenceLogJson
      let log = null
      if (existsSync(logJsonPath)) {
        try {
          log = readJsonFile(logJsonPath)
        } catch (err) {
          logFailed = true
          blockers.push(`unable to read decommission log JSON: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        logFailed = true
        blockers.push('decommission evidence log JSON was not created')
      }

      if (log) {
        if (log.status !== 'complete') {
          readinessBlocked = true
          blockers.push('decommission evidence log is blocked')
        }
        reduced.log = {
          status: log.status,
          release: log.release,
          presence: log.presence,
          path: logJsonPath,
        }
      }
    }

    stepResults.push(reduced)

    if (reduced.exitCode !== 0 && step.id === 'build-decommission-evidence-log') {
      logFailed = true
      blockers.push('decommission evidence log step failed')
    }
  }

  const status = logFailed
    ? 'failed'
    : blockers.length > 0 || readinessBlocked
      ? 'blocked'
      : 'ready'

  const exitCode = logFailed || (plan.strict && status === 'blocked') ? 3 : 0

  return {
    exitCode,
    stdout: plan.json
      ? `${JSON.stringify(
          {
            createdAtUtc: plan.createdAtUtc,
            dir: plan.dir,
            aoGateFile: plan.aoGateFile,
            profile: plan.profile,
            envFile: plan.envFile,
            operator: plan.operator,
            ticket: plan.ticket,
            decision: plan.decision,
            notes: plan.notes,
            strict: plan.strict,
            dryRun: false,
            status,
            exitCode,
            blockers,
            warnings,
            steps: stepResults,
            artifacts: plan.artifacts,
          },
          null,
          2,
        )}\n`
      : (() => {
          const body = renderHumanResult({
            createdAtUtc: plan.createdAtUtc,
            dir: plan.dir,
            aoGateFile: plan.aoGateFile,
            profile: plan.profile,
            envFile: plan.envFile,
            operator: plan.operator,
            ticket: plan.ticket,
            decision: plan.decision,
            notes: plan.notes,
            strict: plan.strict,
            status,
            blockers,
            warnings,
            steps: stepResults,
            artifacts: plan.artifacts,
          })
          return `${stdoutChunks.join('')}${body}`
        })(),
    stderr: stderrChunks.join(''),
    plan,
    steps: stepResults,
    blockers,
    warnings,
    status,
  }
}

function renderHumanResult(summary) {
  const lines = []
  lines.push('# Decommission Closeout')
  lines.push('')
  lines.push(`- Created (UTC): \`${summary.createdAtUtc}\``)
  lines.push(`- Dir: \`${summary.dir}\``)
  lines.push(`- AO gate: \`${summary.aoGateFile}\``)
  lines.push(`- Profile: \`${summary.profile || 'n/a'}\``)
  if (isNonEmptyString(summary.envFile)) lines.push(`- Env file: \`${summary.envFile}\``)
  if (isNonEmptyString(summary.operator)) lines.push(`- Operator: \`${summary.operator}\``)
  if (isNonEmptyString(summary.ticket)) lines.push(`- Ticket: \`${summary.ticket}\``)
  lines.push(`- Decision: \`${summary.decision}\``)
  lines.push(`- Strict: ${summary.strict ? 'yes' : 'no'}`)
  lines.push(`- Status: \`${summary.status}\``)
  lines.push('')
  lines.push('## Steps')
  for (const step of summary.steps) {
    lines.push(`- [${step.index}] ${step.label}: \`${step.status}\` (exit ${typeof step.exitCode === 'number' ? step.exitCode : 'n/a'})`)
  }
  lines.push('')
  lines.push(`- Evidence log markdown: \`${summary.artifacts.decommissionEvidenceLogMd}\``)
  lines.push(`- Evidence log JSON: \`${summary.artifacts.decommissionEvidenceLogJson}\``)

  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('## Warnings')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
  }

  if (summary.blockers.length > 0) {
    lines.push('')
    lines.push('## Blockers')
    for (const blocker of summary.blockers) lines.push(`- ${blocker}`)
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

function runCli(argv = process.argv.slice(2), deps = {}) {
  try {
    const args = parseArgs(argv)
    if (args.help) return { exitCode: 0, stdout: usageText(), stderr: '' }
    return runCloseout(args, deps)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: usageText(), stderr: `error: ${err.message}\n` }
    }
    return { exitCode: 3, stdout: '', stderr: `error: ${err instanceof Error ? err.message : String(err)}\n` }
  }
}

function main() {
  const result = runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) main()

export {
  STEP_SCRIPTS,
  buildCloseoutPlan,
  formatDryRunPlan,
  parseArgs,
  renderHumanResult,
  runCli,
  runCloseout,
  usageText,
}
