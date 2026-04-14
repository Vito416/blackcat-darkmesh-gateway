#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_WORKSPACE_ROOT = resolve(process.cwd(), '..')

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function unique(values) {
  return [...new Set(values.filter((value) => isNonEmptyString(value)))]
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/audit-cross-repo-dataflow.js [--workspace-root <path>] [--json] [--strict] [--help]',
    '',
    'Options:',
    `  --workspace-root <path>   Workspace root that contains blackcat-darkmesh-* repos (default: ${DEFAULT_WORKSPACE_ROOT})`,
    '  --json                    Print JSON only',
    '  --strict                  Exit 3 when any blocker is found',
    '  --help                    Show this help',
    '',
    'Exit codes:',
    '  0   audit passed (or blockers found without --strict)',
    '  3   blocker(s) found in strict mode, or runtime failure',
    '  64  usage error',
  ].join('\n')
}

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function parseArgs(argv) {
  const args = {
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    json: false,
    strict: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
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
      const next = argv[i + 1]
      if (!isNonEmptyString(next) || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      i += 1
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

    if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
    throw new CliError(`unexpected positional argument: ${arg}`, 64)
  }

  return args
}

function readText(path, issues) {
  if (!existsSync(path)) {
    issues.push({
      severity: 'P0',
      code: 'missing_file',
      message: `required file missing: ${path}`,
    })
    return ''
  }
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    issues.push({
      severity: 'P0',
      code: 'read_failed',
      message: `unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    })
    return ''
  }
}

function canonicalFieldFingerprint(sourceText) {
  const fields = []
  const pairs = [
    ['action', /\.action|\.Action/],
    ['tenant', /\.tenant|\.Tenant/],
    ['actor', /\.actor|\.Actor/],
    ['timestamp', /\.timestamp|\.ts|X-Timestamp/],
    ['nonce', /\.nonce|\.Nonce/],
    ['payload', /payload|Payload/],
    ['requestId', /requestId|Request-Id/],
    ['role', /\.role|Actor-Role/],
  ]

  for (const [name, pattern] of pairs) {
    if (pattern.test(sourceText)) fields.push(name)
  }

  return unique(fields)
}

function extractAllowedKeys(workerText) {
  const match = workerText.match(/allowedKeys\s*=\s*new Set\(\[(.*?)\]\)/s)
  if (!match) return []
  const keys = []
  const regex = /'([^']+)'/g
  let next
  while ((next = regex.exec(match[1])) !== null) {
    keys.push(next[1])
  }
  return keys
}

function hasRequiredRoutes(text, routes) {
  return routes.every((route) => text.includes(route))
}

function assessCrossRepoDataflow(options = {}) {
  const workspaceRoot = isNonEmptyString(options.workspaceRoot) ? resolve(options.workspaceRoot) : DEFAULT_WORKSPACE_ROOT
  const gatewayRoot = resolve(workspaceRoot, 'blackcat-darkmesh-gateway')

  const files = {
    contract: resolve(gatewayRoot, 'config/template-backend-contract.json'),
    gatewayTemplateApi: resolve(gatewayRoot, 'src/templateApi.ts'),
    gatewayHandler: resolve(gatewayRoot, 'src/handler.ts'),
    aoPublicApi: resolve(workspaceRoot, 'blackcat-darkmesh-ao/scripts/http/public_api_server.mjs'),
    writeCheckoutApi: resolve(workspaceRoot, 'blackcat-darkmesh-write/scripts/http/checkout_api_server.mjs'),
    workerIndex: resolve(workspaceRoot, 'blackcat-darkmesh-ao/worker/src/index.ts'),
    writeAuth: resolve(workspaceRoot, 'blackcat-darkmesh-write/ao/shared/auth.lua'),
    writeSignScript: resolve(workspaceRoot, 'blackcat-darkmesh-write/scripts/sign-write.js'),
  }

  const findings = []

  const contractRaw = readText(files.contract, findings)
  const templateApiText = readText(files.gatewayTemplateApi, findings)
  const handlerText = readText(files.gatewayHandler, findings)
  const aoPublicApiText = readText(files.aoPublicApi, findings)
  const writeCheckoutApiText = readText(files.writeCheckoutApi, findings)
  const workerText = readText(files.workerIndex, findings)
  const writeAuthText = readText(files.writeAuth, findings)
  const writeSignScriptText = readText(files.writeSignScript, findings)

  let contract = null
  if (isNonEmptyString(contractRaw)) {
    try {
      contract = JSON.parse(contractRaw)
    } catch (error) {
      findings.push({
        severity: 'P0',
        code: 'contract_invalid_json',
        message: `template backend contract is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  if (contract && Array.isArray(contract.allowedActions)) {
    const byName = new Map(contract.allowedActions.map((action) => [action?.name, action]))
    const requiredActions = [
      ['public.resolve-route', 'POST', '/api/public/resolve-route', 'public'],
      ['public.get-page', 'POST', '/api/public/page', 'public'],
      ['checkout.create-order', 'POST', '/api/checkout/order', 'shop_admin'],
      ['checkout.create-payment-intent', 'POST', '/api/checkout/payment-intent', 'shop_admin'],
    ]

    for (const [name, method, path, requiredRole] of requiredActions) {
      const action = byName.get(name)
      if (!action) {
        findings.push({
          severity: 'P0',
          code: 'contract_action_missing',
          message: `contract missing action: ${name}`,
        })
        continue
      }
      if (String(action.method || '').toUpperCase() !== method) {
        findings.push({
          severity: 'P0',
          code: 'contract_method_mismatch',
          message: `contract action ${name} method mismatch (expected ${method})`,
        })
      }
      if (String(action.path || '') !== path) {
        findings.push({
          severity: 'P0',
          code: 'contract_path_mismatch',
          message: `contract action ${name} path mismatch (expected ${path})`,
        })
      }
      const actualRole = String(action?.auth?.requiredRole || '').trim()
      if (actualRole !== requiredRole) {
        findings.push({
          severity: 'P1',
          code: 'contract_role_mismatch',
          message: `contract action ${name} requiredRole mismatch (expected ${requiredRole})`,
        })
      }
    }
  }

  if (isNonEmptyString(aoPublicApiText)) {
    if (!hasRequiredRoutes(aoPublicApiText, ['/api/public/resolve-route', '/api/public/page', '/healthz'])) {
      findings.push({
        severity: 'P0',
        code: 'ao_read_routes_missing',
        message: 'AO public API adapter is missing one or more required routes (/api/public/resolve-route, /api/public/page, /healthz).',
      })
    }
  }

  if (isNonEmptyString(writeCheckoutApiText)) {
    if (!hasRequiredRoutes(writeCheckoutApiText, ['/api/checkout/order', '/api/checkout/payment-intent', '/healthz'])) {
      findings.push({
        severity: 'P0',
        code: 'write_routes_missing',
        message: 'Write checkout adapter is missing one or more required routes (/api/checkout/order, /api/checkout/payment-intent, /healthz).',
      })
    }
  }

  const workerAllowedKeys = extractAllowedKeys(workerText)
  const workerCanonicalFields = canonicalFieldFingerprint(
    workerText.match(/function canonicalDetachedMessage[\s\S]*?\n\}/)?.[0] || '',
  )
  const writeAuthCanonicalFields = canonicalFieldFingerprint(
    writeAuthText.match(/local function canonical_detached_message[\s\S]*?\nend/)?.[0] || '',
  )
  const writeSignScriptFields = canonicalFieldFingerprint(
    writeSignScriptText.match(/function canonicalDetachedMessage\(cmd\) \{[\s\S]*?\n\}/)?.[0] || '',
  )

  const requiredCanonical = ['action', 'tenant', 'actor', 'timestamp', 'nonce', 'payload', 'requestId']
  const hasRequiredCanonical = (fields) => requiredCanonical.every((field) => fields.includes(field))

  if (!hasRequiredCanonical(workerCanonicalFields)) {
    findings.push({
      severity: 'P0',
      code: 'worker_canonical_incomplete',
      message: `worker canonical message fields are incomplete: ${workerCanonicalFields.join(', ')}`,
    })
  }
  if (!hasRequiredCanonical(writeAuthCanonicalFields)) {
    findings.push({
      severity: 'P0',
      code: 'write_auth_canonical_incomplete',
      message: `write auth canonical fields are incomplete: ${writeAuthCanonicalFields.join(', ')}`,
    })
  }
  if (!hasRequiredCanonical(writeSignScriptFields)) {
    findings.push({
      severity: 'P1',
      code: 'write_sign_script_canonical_incomplete',
      message: `write sign script canonical fields are incomplete: ${writeSignScriptFields.join(', ')}`,
    })
  }

  const canonicalFingerprints = [
    JSON.stringify(workerCanonicalFields.filter((field) => requiredCanonical.includes(field))),
    JSON.stringify(writeAuthCanonicalFields.filter((field) => requiredCanonical.includes(field))),
    JSON.stringify(writeSignScriptFields.filter((field) => requiredCanonical.includes(field))),
  ]
  if (new Set(canonicalFingerprints).size > 1) {
    findings.push({
      severity: 'P0',
      code: 'canonical_mismatch_cross_repo',
      message: 'canonical detached message differs between worker/write auth/sign tooling.',
    })
  }

  const roleSigned = workerCanonicalFields.includes('role') && writeAuthCanonicalFields.includes('role')
  if (!roleSigned) {
    findings.push({
      severity: 'P0',
      code: 'unsigned_role_field',
      message: 'write role is not cryptographically bound in detached signature canonical fields (worker + write auth).',
    })
  }

  if (!workerAllowedKeys.includes('role') && !workerAllowedKeys.includes('Role')) {
    findings.push({
      severity: 'P1',
      code: 'worker_sign_role_not_allowed',
      message: 'worker /sign allowlist does not accept role fields, preventing signed role binding.',
    })
  }

  const writeEnvelopeBlock = templateApiText.match(/writeEnvelope\s*=\s*\{([\s\S]*?)\}/)
  if (writeEnvelopeBlock && /role:\s*input\.role/.test(writeEnvelopeBlock[1])) {
    findings.push({
      severity: 'P0',
      code: 'gateway_role_from_caller',
      message: 'gateway write envelope still forwards caller-supplied role for checkout actions.',
    })
  }

  if (!/GATEWAY_SITE_ID_BY_HOST_MAP/.test(handlerText) || !/site_id_host_mismatch/.test(handlerText)) {
    findings.push({
      severity: 'P1',
      code: 'host_site_binding_missing',
      message: 'host->site fail-closed guard is missing or incomplete in gateway handler.',
    })
  }

  const blockers = findings.filter((finding) => finding.severity === 'P0')
  const warnings = findings.filter((finding) => finding.severity === 'P1')
  const niceToHave = [
    'Add an end-to-end smoke that verifies site->variant->templateTxId flow through /template/config and /template/call.',
    'Add an end-to-end smoke that proves x-trace-id propagation across gateway -> worker -> write adapter -> AO result.',
    'Add synthetic chaos probes for read fallback behavior (AO dryrun vs scheduler fallback) with evidence export.',
  ]
  const futureProof = [
    'Publish template bundles as signed release manifests and gate startup on verified variant-map signatures.',
    'Bind signer identity to authorization intent (signatureRef -> allowed actions/roles map) and enforce in write runtime.',
    'Introduce versioned bridge contracts for gateway<->worker and gateway<->AO adapters with compatibility checks in CI.',
  ]

  return {
    checkedAtUtc: new Date().toISOString(),
    workspaceRoot,
    gatewayRoot,
    status: blockers.length === 0 ? 'ready_with_warnings' : 'blocked',
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers,
    warnings,
    files,
    diagnostics: {
      workerAllowedKeys,
      workerCanonicalFields,
      writeAuthCanonicalFields,
      writeSignScriptFields,
      roleSigned,
    },
    niceToHave,
    futureProof,
  }
}

function renderHuman(summary, args) {
  const lines = []
  lines.push(`Cross-repo dataflow audit: ${summary.status}`)
  lines.push(`Workspace: ${summary.workspaceRoot}`)
  lines.push(`Checked: ${summary.checkedAtUtc}`)
  lines.push(`Blockers: ${summary.blockerCount}`)
  lines.push(`Warnings: ${summary.warningCount}`)

  if (summary.blockers.length > 0) {
    lines.push('\nP0 blockers:')
    for (const blocker of summary.blockers) lines.push(`- [${blocker.code}] ${blocker.message}`)
  }

  if (summary.warnings.length > 0) {
    lines.push('\nP1 warnings:')
    for (const warning of summary.warnings) lines.push(`- [${warning.code}] ${warning.message}`)
  }

  lines.push('\nNice-to-have:')
  for (const item of summary.niceToHave) lines.push(`- ${item}`)

  lines.push('\nFuture-proof:')
  for (const item of summary.futureProof) lines.push(`- ${item}`)

  lines.push(`\nStrict mode: ${args.strict ? 'on' : 'off'}`)
  return `${lines.join('\n')}\n`
}

export function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: `${usageText()}\n`,
        stderr: error.exitCode === 0 ? '' : `error: ${error.message}\n`,
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

  let summary
  try {
    summary = assessCrossRepoDataflow({ workspaceRoot: args.workspaceRoot })
  } catch (error) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }

  const hasBlockers = summary.blockerCount > 0
  const exitCode = args.strict && hasBlockers ? 3 : 0
  if (args.json) {
    return { exitCode, stdout: `${JSON.stringify(summary, null, 2)}\n`, stderr: '' }
  }

  return { exitCode, stdout: renderHuman(summary, args), stderr: '' }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCli()
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

export { assessCrossRepoDataflow }
