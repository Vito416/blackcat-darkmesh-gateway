#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_FILE = 'config/template-backend-contract.json'

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
    '  node scripts/validate-template-backend-contract.js [--file <path>] [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --file <PATH>   Template backend contract JSON file (default: config/template-backend-contract.json)',
    '  --json          Print structured JSON only',
    '  --strict        Exit 3 when validation issues are found',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   validation passed, or issues were reported without --strict',
    '  3   validation issues found in --strict mode, or a runtime error occurred',
    '  64  usage error',
  ].join('\n')
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
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
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    if (arg === '--file') {
      args.file = readValue()
      continue
    }

    if (arg.startsWith('--file=')) {
      const value = arg.slice('--file='.length)
      if (!isNonEmptyString(value)) {
        throw new CliError('missing value for --file', 64)
      }
      args.file = value
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }

    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function validateTemplateBackendContract(contract, { contractDir = process.cwd(), workspaceDir = process.cwd() } = {}) {
  const issues = []

  if (!isObject(contract)) {
    return ['contract must be a JSON object']
  }

  if (!Array.isArray(contract.allowedActions)) {
    issues.push('allowedActions must be an array')
  } else if (contract.allowedActions.length === 0) {
    issues.push('allowedActions must be a non-empty array')
  } else {
    const actionNames = new Set()
    const routes = new Set()

    for (let index = 0; index < contract.allowedActions.length; index += 1) {
      const action = contract.allowedActions[index]
      if (!isObject(action)) {
        issues.push(`allowedActions[${index}] must be an object`)
        continue
      }

      const name = normalizeString(action.name)
      if (!name) {
        issues.push(`allowedActions[${index}].name must be a non-empty string`)
      } else if (actionNames.has(name)) {
        issues.push(`allowedActions[${index}].name must be unique`)
      } else {
        actionNames.add(name)
      }

      const method = normalizeString(action.method)
      if (!method) {
        issues.push(`allowedActions[${index}].method must be a non-empty string`)
      }

      const path = normalizeString(action.path)
      if (!path) {
        issues.push(`allowedActions[${index}].path must be a non-empty string`)
      } else if (!path.startsWith('/')) {
        issues.push(`allowedActions[${index}].path must start with "/"`)
      }

      for (const field of ['requestSchemaRef', 'responseSchemaRef']) {
        const schemaRef = normalizeString(action[field])
        if (!schemaRef) continue
        const schemaCandidates = [resolve(workspaceDir, schemaRef), resolve(contractDir, schemaRef)]
        const schemaExists = schemaCandidates.some((schemaPath) => existsSync(schemaPath))
        if (!schemaExists) {
          issues.push(`allowedActions[${index}].${field} file not found: ${schemaRef}`)
        }
      }

      if (method && path) {
        const routeKey = `${method} ${path}`
        if (routes.has(routeKey)) {
          issues.push(`allowedActions[${index}] duplicates route ${routeKey}`)
        } else {
          routes.add(routeKey)
        }
      }
    }
  }

  if (!Array.isArray(contract.forbiddenCapabilities)) {
    issues.push('forbiddenCapabilities must be an array')
  } else if (contract.forbiddenCapabilities.length === 0) {
    issues.push('forbiddenCapabilities must be a non-empty array')
  } else {
    const capabilities = new Set()
    for (let index = 0; index < contract.forbiddenCapabilities.length; index += 1) {
      const capability = normalizeString(contract.forbiddenCapabilities[index])
      if (!capability) {
        issues.push(`forbiddenCapabilities[${index}] must be a non-empty string`)
      } else if (capabilities.has(capability)) {
        issues.push(`forbiddenCapabilities[${index}] must be unique`)
      } else {
        capabilities.add(capability)
      }
    }
  }

  return issues
}

function renderHumanSummary(result, args) {
  const lines = []

  if (result.ok) {
    lines.push('Template backend contract passed')
  } else {
    lines.push('Template backend contract issues found')
  }

  lines.push(`File: ${args.file}`)
  lines.push(`Strict: ${args.strict ? 'yes' : 'no'}`)
  lines.push(`Allowed actions: ${result.allowedActionCount}`)
  lines.push(`Forbidden capabilities: ${result.forbiddenCapabilityCount}`)
  lines.push(`Issues found: ${result.issueCount}`)

  for (const issue of result.issues) {
    lines.push(`- ${issue}`)
  }

  return `${lines.join('\n')}\n`
}

function renderJsonSummary(result, args) {
  return JSON.stringify(
    {
      status: result.ok ? 'pass' : 'issues-found',
      file: args.file,
      strict: args.strict,
      allowedActionCount: result.allowedActionCount,
      forbiddenCapabilityCount: result.forbiddenCapabilityCount,
      issueCount: result.issueCount,
      issues: result.issues,
    },
    null,
    2,
  )
}

async function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: `${usageText()}\n`, stderr: `error: ${err.message}\n` }
    }
    return {
      exitCode: 64,
      stdout: `${usageText()}\n`,
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  if (args.help) {
    return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
  }

  let text
  try {
    text = await readFile(args.file, 'utf8')
  } catch (err) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: unable to read contract file: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  let contract
  try {
    contract = JSON.parse(text)
  } catch (err) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: invalid template backend contract: malformed JSON (${err instanceof Error ? err.message : String(err)})\n`,
    }
  }

  const contractDir = dirname(resolve(args.file))
  const workspaceDir = process.cwd()
  const issues = validateTemplateBackendContract(contract, { contractDir, workspaceDir })
  const result = {
    ok: issues.length === 0,
    allowedActionCount: Array.isArray(contract?.allowedActions) ? contract.allowedActions.length : 0,
    forbiddenCapabilityCount: Array.isArray(contract?.forbiddenCapabilities) ? contract.forbiddenCapabilities.length : 0,
    issueCount: issues.length,
    issues,
  }

  return {
    exitCode: result.ok || !args.strict ? 0 : 3,
    stdout: args.json ? `${renderJsonSummary(result, args)}\n` : renderHumanSummary(result, args),
    stderr: '',
  }
}

async function main() {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(3)
  })
}

export {
  CliError,
  isNonEmptyString,
  normalizeString,
  parseArgs,
  renderHumanSummary,
  renderJsonSummary,
  runCli,
  usageText,
  validateTemplateBackendContract,
}
