#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_WORKSPACE_ROOT = resolve(process.cwd(), '..')
const REQUIRED_ACTION_SPECS = new Map([
  ['public.resolve-route', { method: 'POST', path: '/api/public/resolve-route' }],
  ['public.site-by-host', { method: 'POST', path: '/api/public/site-by-host' }],
  ['public.get-page', { method: 'POST', path: '/api/public/page' }],
  ['checkout.create-order', { method: 'POST', path: '/api/checkout/order' }],
  ['checkout.create-payment-intent', { method: 'POST', path: '/api/checkout/payment-intent' }],
])

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

function normalize(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseSemver(version) {
  const match = normalize(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/check-template-bridge-contract.js [--workspace-root <path>] [--json] [--strict] [--help]',
    '',
    'Options:',
    `  --workspace-root <PATH>   Workspace root containing blackcat-darkmesh-* repos (default: ${DEFAULT_WORKSPACE_ROOT})`,
    '  --json                    Print structured JSON only',
    '  --strict                  Exit 3 when compatibility issues are found',
    '  --help                    Show this help',
    '',
    'Exit codes:',
    '  0   compatibility passed, or issues were reported without --strict',
    '  3   compatibility issues found in --strict mode, or a runtime error occurred',
    '  64  usage error',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
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
      if (!isNonEmptyString(next) || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    if (arg === '--workspace-root') {
      args.workspaceRoot = resolve(readValue())
      continue
    }

    if (arg.startsWith('--workspace-root=')) {
      const value = arg.slice('--workspace-root='.length)
      if (!isNonEmptyString(value)) throw new CliError('missing value for --workspace-root', 64)
      args.workspaceRoot = resolve(value)
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`unknown option: ${arg}`, 64)
    }

    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function readText(path, issues, label) {
  if (!existsSync(path)) {
    issues.push({
      code: 'missing_file',
      message: `${label} is missing: ${path}`,
      files: [path],
    })
    return ''
  }

  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    issues.push({
      code: 'read_failed',
      message: `unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
      files: [path],
    })
    return ''
  }
}

function readJson(path, issues, label) {
  const text = readText(path, issues, label)
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch (error) {
    issues.push({
      code: 'invalid_json',
      message: `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      files: [path],
    })
    return null
  }
}

function extractGatewayPolicies(text) {
  const policies = []
  const actionRegex = /action:\s*'([^']+)'/g
  let match

  while ((match = actionRegex.exec(text)) !== null) {
    const slice = text.slice(match.index, match.index + 900)
    const path = slice.match(/path:\s*'([^']+)'/)?.[1]
    const method = slice.match(/method:\s*'([^']+)'/)?.[1]
    const target = slice.match(/target:\s*'([^']+)'/)?.[1]
    const kind = slice.match(/kind:\s*'([^']+)'/)?.[1]
    if (path && method && target) {
      policies.push({
        action: match[1],
        path,
        method,
        target,
        kind: kind || '',
      })
    }
  }

  return policies
}

function extractRoutePaths(text, pattern) {
  const routes = new Set()
  const regex = new RegExp(pattern, 'g')
  let match
  while ((match = regex.exec(text)) !== null) {
    routes.add(match[1])
  }
  return routes
}

function extractAoPublicRoutes(text) {
  return extractRoutePaths(text, String.raw`'(/api/public/[a-z0-9-]+)'`)
}

function renderHumanSummary(result, args) {
  const lines = []

  if (result.ok) {
    lines.push('Template bridge contract passed')
  } else {
    lines.push('Template bridge contract issues found')
  }

  lines.push(`Workspace: ${args.workspaceRoot}`)
  lines.push(`Contract schemaVersion: ${result.contractVersion.schemaVersion || 'n/a'}`)
  lines.push(`Contract templateVersion: ${result.contractVersion.templateVersion || 'n/a'}`)
  lines.push(`AO worker package: ${result.contractVersion.aoPackageVersion || 'n/a'}`)
  lines.push(`Write package: ${result.contractVersion.writePackageVersion || 'n/a'}`)
  lines.push(`Issues found: ${result.issueCount}`)

  for (const issue of result.issues) {
    lines.push(`- [${issue.code}] ${issue.message}`)
  }

  return `${lines.join('\n')}\n`
}

function renderJsonSummary(result, args) {
  return JSON.stringify(
    {
      status: result.ok ? 'pass' : 'issues-found',
      workspaceRoot: args.workspaceRoot,
      issueCount: result.issueCount,
      contractVersion: result.contractVersion,
      issues: result.issues,
    },
    null,
    2,
  )
}

function assessTemplateBridgeContract(options = {}) {
  const workspaceRoot = isNonEmptyString(options.workspaceRoot) ? resolve(options.workspaceRoot) : DEFAULT_WORKSPACE_ROOT
  const gatewayRoot = resolve(workspaceRoot, 'blackcat-darkmesh-gateway')
  const aoRoot = resolve(workspaceRoot, 'blackcat-darkmesh-ao')
  const writeRoot = resolve(workspaceRoot, 'blackcat-darkmesh-write')

  const files = {
    contract: resolve(gatewayRoot, 'config/template-backend-contract.json'),
    gatewayActions: resolve(gatewayRoot, 'src/runtime/template/actions.ts'),
    aoPackage: resolve(aoRoot, 'package.json'),
    aoPublicAdapter: resolve(aoRoot, 'scripts/http/public_api_server.mjs'),
    writePackage: resolve(writeRoot, 'package.json'),
    writeCheckout: resolve(writeRoot, 'scripts/http/checkout_api_server.mjs'),
  }

  const issues = []

  const contractRaw = readJson(files.contract, issues, 'gateway template backend contract')
  const gatewayActionsText = readText(files.gatewayActions, issues, 'gateway runtime template action catalog')
  const aoPackage = readJson(files.aoPackage, issues, 'AO worker package manifest')
  const aoPublicAdapterText = readText(files.aoPublicAdapter, issues, 'AO public API adapter')
  const writePackage = readJson(files.writePackage, issues, 'write adapter package manifest')
  const writeCheckoutText = readText(files.writeCheckout, issues, 'write checkout adapter')

  const contractVersion = {
    schemaVersion: normalize(contractRaw?.schemaVersion),
    templateVersion: normalize(contractRaw?.templateVersion),
    aoPackageVersion: normalize(aoPackage?.version),
    writePackageVersion: normalize(writePackage?.version),
  }

  const schemaParsed = parseSemver(contractVersion.schemaVersion)
  const templateParsed = parseSemver(contractVersion.templateVersion)
  const aoParsed = parseSemver(contractVersion.aoPackageVersion)
  const writeParsed = parseSemver(contractVersion.writePackageVersion)

  if (!schemaParsed) {
    issues.push({
      code: 'schema_version_invalid',
      message: `config/template-backend-contract.json schemaVersion must be semver-like (got "${contractVersion.schemaVersion || 'empty'}")`,
      files: [files.contract],
    })
  }

  if (!templateParsed) {
    issues.push({
      code: 'template_version_invalid',
      message: `config/template-backend-contract.json templateVersion must be semver-like (got "${contractVersion.templateVersion || 'empty'}")`,
      files: [files.contract],
    })
  }

  if (schemaParsed && templateParsed && schemaParsed.major !== templateParsed.major) {
    issues.push({
      code: 'contract_major_mismatch',
      message: `contract schemaVersion major ${schemaParsed.major} does not match templateVersion major ${templateParsed.major}; bump them together in config/template-backend-contract.json`,
      files: [files.contract],
    })
  }

  if (templateParsed && aoParsed && templateParsed.major !== aoParsed.major) {
    issues.push({
      code: 'ao_package_major_mismatch',
      message: `blackcat-darkmesh-ao/package.json major ${aoParsed.major} does not match bridge templateVersion major ${templateParsed.major}; update the bridge contract or worker package version together`,
      files: [files.aoPackage, files.contract],
    })
  }

  if (!aoParsed) {
    issues.push({
      code: 'ao_package_version_invalid',
      message: `blackcat-darkmesh-ao/package.json version must be semver-like (got "${contractVersion.aoPackageVersion || 'empty'}")`,
      files: [files.aoPackage],
    })
  }

  if (templateParsed && writeParsed && templateParsed.major !== writeParsed.major) {
    issues.push({
      code: 'write_package_major_mismatch',
      message: `blackcat-darkmesh-write/package.json major ${writeParsed.major} does not match bridge templateVersion major ${templateParsed.major}; update the bridge contract or write package version together`,
      files: [files.writePackage, files.contract],
    })
  }

  if (!writeParsed) {
    issues.push({
      code: 'write_package_version_invalid',
      message: `blackcat-darkmesh-write/package.json version must be semver-like (got "${contractVersion.writePackageVersion || 'empty'}")`,
      files: [files.writePackage],
    })
  }

  const contractActions = Array.isArray(contractRaw?.allowedActions) ? contractRaw.allowedActions : []
  if (!Array.isArray(contractRaw?.allowedActions)) {
    issues.push({
      code: 'contract_actions_invalid',
      message: 'config/template-backend-contract.json allowedActions must be an array',
      files: [files.contract],
    })
  }

  const contractByName = new Map()
  for (let index = 0; index < contractActions.length; index += 1) {
    const action = contractActions[index]
    const actionName = normalize(action?.name)
    const method = normalize(action?.method).toUpperCase()
    const path = normalize(action?.path)

    if (!actionName) {
      issues.push({
        code: 'contract_action_name_missing',
        message: `config/template-backend-contract.json allowedActions[${index}].name must be a non-empty string`,
        files: [files.contract],
      })
      continue
    }

    contractByName.set(actionName, { method, path })
  }

  for (const [actionName, expected] of REQUIRED_ACTION_SPECS.entries()) {
    const found = contractByName.get(actionName)
    if (!found) {
      issues.push({
        code: 'required_contract_action_missing',
        message: `bridge contract must include required action ${actionName} (${expected.method} ${expected.path})`,
        files: [files.contract],
      })
      continue
    }

    if (found.method !== expected.method) {
      issues.push({
        code: 'required_contract_action_method_mismatch',
        message: `bridge contract action ${actionName} must use method ${expected.method} (got ${found.method || 'empty'})`,
        files: [files.contract],
      })
    }

    if (found.path !== expected.path) {
      issues.push({
        code: 'required_contract_action_path_mismatch',
        message: `bridge contract action ${actionName} must use path ${expected.path} (got ${found.path || 'empty'})`,
        files: [files.contract],
      })
    }
  }

  const gatewayPolicies = extractGatewayPolicies(gatewayActionsText)
  const gatewayByAction = new Map(gatewayPolicies.map((policy) => [policy.action, policy]))

  for (const [actionName, contractAction] of contractByName.entries()) {
    const gatewayAction = gatewayByAction.get(actionName)
    if (!gatewayAction) {
      issues.push({
        code: 'gateway_action_missing',
        message: `gateway runtime is missing action ${actionName}; add or keep the matching entry in src/runtime/template/actions.ts`,
        files: [files.gatewayActions, files.contract],
      })
      continue
    }

    if (gatewayAction.method !== contractAction.method) {
      issues.push({
        code: 'gateway_action_method_mismatch',
        message: `gateway runtime action ${actionName} uses method ${gatewayAction.method} but the bridge contract expects ${contractAction.method}`,
        files: [files.gatewayActions, files.contract],
      })
    }

    if (gatewayAction.path !== contractAction.path) {
      issues.push({
        code: 'gateway_action_path_mismatch',
        message: `gateway runtime action ${actionName} uses path ${gatewayAction.path} but the bridge contract expects ${contractAction.path}; update src/runtime/template/actions.ts and config/template-backend-contract.json together`,
        files: [files.gatewayActions, files.contract],
      })
    }
  }

  for (const gatewayAction of gatewayPolicies) {
    if (!contractByName.has(gatewayAction.action)) {
      issues.push({
        code: 'contract_action_missing',
        message: `bridge contract is missing gateway action ${gatewayAction.action}; add it to config/template-backend-contract.json before merging`,
        files: [files.contract, files.gatewayActions],
      })
    }
  }

  const aoPublicRoutes = extractAoPublicRoutes(aoPublicAdapterText)
  for (const gatewayAction of gatewayPolicies.filter((action) => action.target === 'ao')) {
    if (!aoPublicRoutes.has(gatewayAction.path)) {
      issues.push({
        code: 'ao_public_route_missing',
        message: `AO public API adapter is missing ${gatewayAction.path}; add the route in blackcat-darkmesh-ao/scripts/http/public_api_server.mjs so ${gatewayAction.action} stays reachable`,
        files: [files.aoPublicAdapter, files.contract],
      })
    }
  }

  for (const [actionName, contractAction] of contractByName.entries()) {
    if (!contractAction.path.startsWith('/api/public/')) continue
    if (!aoPublicRoutes.has(contractAction.path)) {
      issues.push({
        code: 'ao_public_contract_route_missing',
        message: `AO public API adapter is missing ${contractAction.path}; keep blackcat-darkmesh-ao/scripts/http/public_api_server.mjs in sync with bridge action ${actionName}`,
        files: [files.aoPublicAdapter, files.contract],
      })
    }
  }

  const writeRoutes = extractRoutePaths(writeCheckoutText, String.raw`pathname\s*===\s*'([^']+)'`)
  for (const gatewayAction of gatewayPolicies.filter((action) => action.target === 'write')) {
    if (!writeRoutes.has(gatewayAction.path)) {
      issues.push({
        code: 'write_route_missing',
        message: `write checkout adapter is missing ${gatewayAction.path}; add the branch in blackcat-darkmesh-write/scripts/http/checkout_api_server.mjs so ${gatewayAction.action} stays reachable`,
        files: [files.writeCheckout, files.contract],
      })
    }
  }

  const result = {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    contractVersion,
  }

  return { result, files }
}

function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: `${usageText()}\n`,
        stderr: `error: ${error.message}\n`,
      }
    }
    return {
      exitCode: 64,
      stdout: `${usageText()}\n`,
      stderr: `error: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }

  if (args.help) {
    return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
  }

  try {
    const { result } = assessTemplateBridgeContract({ workspaceRoot: args.workspaceRoot })
    return {
      exitCode: result.ok || !args.strict ? 0 : 3,
      stdout: args.json ? `${renderJsonSummary(result, args)}\n` : renderHumanSummary(result, args),
      stderr: '',
    }
  } catch (error) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

async function main() {
  const result = runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(3)
  })
}

export {
  assessTemplateBridgeContract,
  parseArgs,
  parseSemver,
  renderHumanSummary,
  renderJsonSummary,
  runCli,
  usageText,
}
