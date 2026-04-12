#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VALID_MODES = new Set(['pairwise', 'all'])
const VALID_PROFILES = new Set(['wedos_small', 'wedos_medium', 'diskless'])
const DEFAULT_RELEASE = '1.4.0'
const DEFAULT_PROFILE = 'wedos_medium'
const DEFAULT_MODE = 'pairwise'
const DEFAULT_OUT_ROOT = './tmp/release-drills'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_AO_GATE_FILE = resolve(REPO_ROOT, 'kernel-migration/ao-dependency-gate.json')

const STEP_SCRIPTS = {
  preflight: resolve(SCRIPT_DIR, 'validate-consistency-preflight.js'),
  compare: resolve(SCRIPT_DIR, 'compare-integrity-matrix.js'),
  exportReport: resolve(SCRIPT_DIR, 'export-consistency-report.js'),
  exportEvidence: resolve(SCRIPT_DIR, 'export-integrity-evidence.js'),
  latestBundle: resolve(SCRIPT_DIR, 'latest-evidence-bundle.js'),
  checkEvidence: resolve(SCRIPT_DIR, 'check-evidence-bundle.js'),
  validateAoGate: resolve(SCRIPT_DIR, 'validate-ao-dependency-gate.js'),
  checkLegacyCoreEvidence: resolve(SCRIPT_DIR, 'check-legacy-core-extraction-evidence.js'),
  checkLegacyCryptoEvidence: resolve(SCRIPT_DIR, 'check-legacy-crypto-boundary-evidence.js'),
  checkTemplateWorkerMapCoherence: resolve(SCRIPT_DIR, 'check-template-worker-map-coherence.js'),
  checkForgetForwardConfig: resolve(SCRIPT_DIR, 'check-forget-forward-config.js'),
  checkTemplateSignatureRefMap: resolve(SCRIPT_DIR, 'check-template-signature-ref-map.js'),
  buildPack: resolve(SCRIPT_DIR, 'build-release-evidence-pack.js'),
  buildChecklist: resolve(SCRIPT_DIR, 'build-release-signoff-checklist.js'),
  checkReadiness: resolve(SCRIPT_DIR, 'check-release-readiness.js'),
  buildDrillManifest: resolve(SCRIPT_DIR, 'build-release-drill-manifest.js'),
  validateDrillManifest: resolve(SCRIPT_DIR, 'validate-release-drill-manifest.js'),
  checkDrillArtifacts: resolve(SCRIPT_DIR, 'check-release-drill-artifacts.js'),
  buildLedger: resolve(SCRIPT_DIR, 'build-release-evidence-ledger.js'),
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

function usageText() {
  return [
    'Usage:',
    '  node scripts/run-release-drill.js --urls <csv> [--out-dir <dir> | --out-root <dir>] [--run-label <label>] [--profile wedos_small|wedos_medium|diskless] [--mode pairwise|all] [--token <value>] [--allow-anon] [--release <label>] [--strict] [--dry-run] [--help]',
    '',
    'Options:',
    '  --urls <CSV>        Comma-separated gateway URLs (required)',
    '  --out-dir <DIR>     Exact directory for drill artifacts',
    '  --out-root <DIR>    Root for auto-generated drill directory (default: ./tmp/release-drills)',
    '  --run-label <TEXT>  Optional slug appended to auto-generated directory name',
    '  --profile <NAME>    wedos_small|wedos_medium|diskless (default: wedos_medium)',
    '  --mode <MODE>       pairwise (default) or all',
    '  --token <VALUE>     Optional integrity state token',
    '  --allow-anon        Allow anonymous preflight validation',
    '  --release <LABEL>   Release label used for the evidence pack (default: 1.4.0)',
    '  --strict            Run readiness check in strict mode',
    '  --dry-run           Print the planned commands without running them',
    '  --help              Show this help',
    '',
    'Output directory rules:',
    '  - Use --out-dir for an exact path',
    '  - Use --out-root to choose the parent directory while keeping auto naming',
    '  - If neither is provided, output defaults to ./tmp/release-drills/<release>-<profile>-<mode>-<timestamp>',
    '',
    'Sequence:',
    '  1) validate consistency preflight',
    '  2) compare integrity matrix',
    '  3) export consistency report',
    '  4) export integrity evidence bundle',
    '  5) select latest evidence bundle',
    '  6) validate latest evidence bundle',
    '  7) validate AO dependency gate',
    '  8) check legacy core extraction evidence',
    '  9) check legacy crypto boundary evidence',
    '  10) check template worker map coherence',
    '  11) check forget-forward config',
    '  12) check template signature-ref map',
    '  13) build release evidence pack',
    '  14) build release sign-off checklist',
    '  15) check release readiness',
    '  16) build release drill manifest',
    '  17) validate release drill manifest',
    '  18) check release drill artifacts',
    '  19) build release evidence ledger',
    '',
    'Exit codes:',
    '  0   success',
    '  3   failed drill/data error',
    '  64  usage error',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    help: false,
    urlsCsv: '',
    outDir: '',
    outRoot: '',
    runLabel: '',
    profile: DEFAULT_PROFILE,
    mode: DEFAULT_MODE,
    token: '',
    allowAnon: false,
    release: DEFAULT_RELEASE,
    strict: false,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }
    if (arg === '--allow-anon') {
      args.allowAnon = true
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
      if (typeof next === 'undefined' || next.startsWith('--')) {
        throw new CliError(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--urls':
        args.urlsCsv = readValue()
        break
      case '--out-dir':
        args.outDir = readValue()
        break
      case '--out-root':
        args.outRoot = readValue()
        break
      case '--run-label':
        args.runLabel = readValue().trim()
        break
      case '--profile':
        args.profile = readValue().trim().toLowerCase()
        break
      case '--mode':
        args.mode = readValue().trim().toLowerCase()
        break
      case '--token':
        args.token = readValue()
        break
      case '--release':
        args.release = readValue().trim()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.urlsCsv)) throw new CliError('--urls is required', 64)
  if (isNonEmptyString(args.outDir) && isNonEmptyString(args.outRoot)) {
    throw new CliError('use only one of --out-dir or --out-root', 64)
  }
  if (!VALID_PROFILES.has(args.profile)) throw new CliError(`unsupported --profile value: ${args.profile}`, 64)
  if (!VALID_MODES.has(args.mode)) throw new CliError(`unsupported --mode value: ${args.mode}`, 64)
  if (!isNonEmptyString(args.release)) throw new CliError('--release must not be blank', 64)
  if (args.runLabel && !isNonEmptyString(args.runLabel)) throw new CliError('--run-label must not be blank', 64)
  if (args.token && !isNonEmptyString(args.token)) throw new CliError('--token must not be blank', 64)
  if (!isNonEmptyString(args.outDir)) {
    args.outDir = buildAutoOutDir(args)
  }

  return args
}

function slugifySegment(value, fallback) {
  if (!isNonEmptyString(value)) return fallback
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug.length > 0 ? slug : fallback
}

function buildTimestampLabel(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function buildAutoOutDir({ outRoot = '', release = DEFAULT_RELEASE, profile = DEFAULT_PROFILE, mode = DEFAULT_MODE, runLabel = '' } = {}) {
  const root = isNonEmptyString(outRoot) ? outRoot : DEFAULT_OUT_ROOT
  const stamp = slugifySegment(runLabel || buildTimestampLabel(), 'run')
  const releaseSlug = slugifySegment(release, 'release')
  return resolve(root, `${releaseSlug}-${profile}-${mode}-${stamp}`)
}

function quoteArg(value) {
  const text = String(value)
  if (text.length === 0) return '""'
  if (/^<.*>$/.test(text)) return text
  if (/^[A-Za-z0-9._:@/+=,-]+$/.test(text)) return text
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function redactTokenArgs(args) {
  const out = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    out.push(arg)
    if (arg === '--token' && typeof args[index + 1] !== 'undefined') {
      out.push('<value>')
      index += 1
    }
  }
  return out
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => quoteArg(arg))].join(' ')
}

function splitUrls(csv) {
  return csv
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseJsonObject(value) {
  if (!isNonEmptyString(value)) return null

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch (_) {
    return null
  }
}

function countObjectEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0
}

function buildTemplateSignatureRefMapCheckConfig(rawMap) {
  if (!isNonEmptyString(rawMap)) {
    return {
      configured: false,
      env: { GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP: '{}' },
      args: ['--json'],
      displayArgs: ['--json'],
      requiredSites: [],
    }
  }

  const parsed = parseJsonObject(rawMap)
  const requiredSites = parsed ? Object.keys(parsed).map((site) => site.trim()).filter(Boolean) : []
  const configured = requiredSites.length > 0
  const args = ['--json', '--strict']
  if (!configured) {
    return {
      configured: false,
      env: { GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP: rawMap },
      args: ['--json'],
      displayArgs: ['--json'],
      requiredSites: [],
    }
  }

  args.push('--require-sites', requiredSites.join(','))

  return {
    configured: true,
    env: { GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP: rawMap },
    args,
    displayArgs: [...args],
    requiredSites,
  }
}

function buildTemplateWorkerMapCoherenceCheckConfig(urlMapRaw, tokenMapRaw, signatureRefMapRaw) {
  const parsedUrlMap = parseJsonObject(urlMapRaw)
  const parsedTokenMap = parseJsonObject(tokenMapRaw)
  const parsedSignatureRefMap = parseJsonObject(signatureRefMapRaw)
  const urlMapCount = countObjectEntries(parsedUrlMap)
  const tokenMapCount = countObjectEntries(parsedTokenMap)
  const signatureRefMapCount = countObjectEntries(parsedSignatureRefMap)
  const configured = urlMapCount > 0 || tokenMapCount > 0 || signatureRefMapCount > 0
  const env = {}

  if (isNonEmptyString(urlMapRaw)) {
    env.GATEWAY_TEMPLATE_WORKER_URL_MAP = urlMapRaw
  }
  if (isNonEmptyString(tokenMapRaw)) {
    env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP = tokenMapRaw
  }
  if (isNonEmptyString(signatureRefMapRaw)) {
    env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP = signatureRefMapRaw
  }

  const args = ['--json']
  if (configured) {
    args.push('--strict')
    args.push('--require-token-map', '--require-signature-map')
  }

  return {
    configured,
    env,
    args,
    displayArgs: [...args],
    counts: {
      urlMapCount,
      tokenMapCount,
      signatureRefMapCount,
    },
  }
}

function buildForgetForwardCheckConfig() {
  const args = ['--json']
  return {
    args,
    displayArgs: [...args],
  }
}

function stepLabel(step, total) {
  return `[${step.index}/${total}] ${step.label}`
}

function getStepArgs(step, context) {
  return typeof step.args === 'function' ? step.args(context) : step.args
}

function buildDrillPlan({
  urlsCsv,
  outDir,
  profile = DEFAULT_PROFILE,
  mode = DEFAULT_MODE,
  token = '',
  allowAnon = false,
  release = DEFAULT_RELEASE,
  strict = false,
} = {}) {
  const resolvedOutDir = resolve(outDir)
  const urls = splitUrls(urlsCsv || '')
  const evidenceRoot = join(resolvedOutDir, 'evidence')
  const packMd = join(resolvedOutDir, 'release-evidence-pack.md')
  const packJson = join(resolvedOutDir, 'release-evidence-pack.json')
  const checklistMd = join(resolvedOutDir, 'release-signoff-checklist.md')
  const matrixJson = join(resolvedOutDir, 'consistency-matrix.json')
  const reportMd = join(resolvedOutDir, 'consistency-drift-report.md')
  const summaryJson = join(resolvedOutDir, 'consistency-drift-summary.json')
  const latestBundleJson = join(resolvedOutDir, 'latest-evidence-bundle.json')
  const aoGateValidationTxt = join(resolvedOutDir, 'ao-dependency-gate.validation.txt')
  const legacyCoreEvidenceJson = join(resolvedOutDir, 'legacy-core-extraction-evidence.json')
  const legacyCryptoEvidenceJson = join(resolvedOutDir, 'legacy-crypto-boundary-evidence.json')
  const templateWorkerMapCoherenceJson = join(resolvedOutDir, 'template-worker-map-coherence.json')
  const forgetForwardConfigJson = join(resolvedOutDir, 'forget-forward-config.json')
  const templateSignatureRefMapJson = join(resolvedOutDir, 'template-signature-ref-map.json')
  const drillChecksJson = join(resolvedOutDir, 'release-drill-checks.json')
  const readinessJson = join(resolvedOutDir, 'release-readiness.json')
  const drillManifestJson = join(resolvedOutDir, 'release-drill-manifest.json')
  const drillManifestValidation = join(resolvedOutDir, 'release-drill-manifest.validation.txt')
  const drillCheckJson = join(resolvedOutDir, 'release-drill-check.json')
  const ledgerMd = join(resolvedOutDir, 'release-evidence-ledger.md')
  const ledgerJson = join(resolvedOutDir, 'release-evidence-ledger.json')
  const templateWorkerMapCoherenceCheck = buildTemplateWorkerMapCoherenceCheckConfig(
    process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP || '',
    process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP || '',
    process.env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP || '',
  )
  const forgetForwardConfigCheck = buildForgetForwardCheckConfig()
  const templateSignatureRefMapCheck = buildTemplateSignatureRefMapCheckConfig(
    process.env.GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP || '',
  )

  const preflightArgs = ['--urls', urlsCsv, '--mode', mode, '--profile', profile]
  if (isNonEmptyString(token)) preflightArgs.push('--token', token)
  else if (allowAnon) preflightArgs.push('--allow-anon')

  const compareArgs = [...urls.flatMap((url) => ['--url', url]), '--mode', mode, '--json']
  const exportEvidenceArgs = [...urls.flatMap((url) => ['--url', url]), '--out-dir', evidenceRoot]
  if (isNonEmptyString(token)) {
    compareArgs.push('--token', token)
    exportEvidenceArgs.push('--token', token)
  }

  const steps = [
    {
      id: 'preflight',
      index: 1,
      label: 'validate consistency preflight',
      command: 'node',
      scriptPath: STEP_SCRIPTS.preflight,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.preflight),
      args: preflightArgs,
      displayArgs: redactTokenArgs(preflightArgs),
    },
    {
      id: 'compare',
      index: 2,
      label: 'compare integrity matrix',
      command: 'node',
      scriptPath: STEP_SCRIPTS.compare,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.compare),
      args: compareArgs,
      displayArgs: redactTokenArgs(compareArgs),
      outputFile: matrixJson,
    },
    {
      id: 'export-report',
      index: 3,
      label: 'export consistency report',
      command: 'node',
      scriptPath: STEP_SCRIPTS.exportReport,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.exportReport),
      args: ['--matrix', matrixJson, '--out-dir', resolvedOutDir, '--profile', profile],
      displayArgs: ['--matrix', matrixJson, '--out-dir', resolvedOutDir, '--profile', profile],
      outputFiles: [reportMd, summaryJson],
    },
    {
      id: 'export-evidence',
      index: 4,
      label: 'export integrity evidence bundle',
      command: 'node',
      scriptPath: STEP_SCRIPTS.exportEvidence,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.exportEvidence),
      args: exportEvidenceArgs,
      displayArgs: redactTokenArgs(exportEvidenceArgs),
    },
    {
      id: 'latest-bundle',
      index: 5,
      label: 'select latest evidence bundle',
      command: 'node',
      scriptPath: STEP_SCRIPTS.latestBundle,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.latestBundle),
      args: ['--root', evidenceRoot, '--json', '--require-files'],
      displayArgs: ['--root', evidenceRoot, '--json', '--require-files'],
      outputFile: latestBundleJson,
    },
    {
      id: 'check-evidence',
      index: 6,
      label: 'validate latest evidence bundle',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkEvidence,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkEvidence),
      args: (context) => ['--dir', context.latestBundleDir || '<latest-bundle-dir>', '--strict'],
      displayArgs: ['--dir', '<latest-bundle-dir>', '--strict'],
    },
    {
      id: 'validate-ao-gate',
      index: 7,
      label: 'validate AO dependency gate',
      command: 'node',
      scriptPath: STEP_SCRIPTS.validateAoGate,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.validateAoGate),
      args: ['--file', DEFAULT_AO_GATE_FILE],
      displayArgs: ['--file', DEFAULT_AO_GATE_FILE],
      outputFile: aoGateValidationTxt,
    },
    {
      id: 'check-legacy-core-evidence',
      index: 8,
      label: 'check legacy core extraction evidence',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkLegacyCoreEvidence,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkLegacyCoreEvidence),
      args: ['--strict', '--json'],
      displayArgs: ['--strict', '--json'],
      outputFile: legacyCoreEvidenceJson,
    },
    {
      id: 'check-legacy-crypto-evidence',
      index: 9,
      label: 'check legacy crypto boundary evidence',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkLegacyCryptoEvidence,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkLegacyCryptoEvidence),
      args: ['--strict', '--json'],
      displayArgs: ['--strict', '--json'],
      outputFile: legacyCryptoEvidenceJson,
    },
    {
      id: 'check-template-worker-map-coherence',
      index: 10,
      label: 'check template worker map coherence',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkTemplateWorkerMapCoherence,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkTemplateWorkerMapCoherence),
      args: templateWorkerMapCoherenceCheck.args,
      displayArgs: templateWorkerMapCoherenceCheck.displayArgs,
      env: templateWorkerMapCoherenceCheck.env,
      outputFile: templateWorkerMapCoherenceJson,
    },
    {
      id: 'check-forget-forward-config',
      index: 11,
      label: 'check forget-forward config',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkForgetForwardConfig,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkForgetForwardConfig),
      args: forgetForwardConfigCheck.args,
      displayArgs: forgetForwardConfigCheck.displayArgs,
      outputFile: forgetForwardConfigJson,
    },
    {
      id: 'check-template-signature-ref-map',
      index: 12,
      label: 'check template signature-ref map',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkTemplateSignatureRefMap,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkTemplateSignatureRefMap),
      args: templateSignatureRefMapCheck.args,
      displayArgs: templateSignatureRefMapCheck.displayArgs,
      env: templateSignatureRefMapCheck.env,
      outputFile: templateSignatureRefMapJson,
    },
    {
      id: 'build-pack',
      index: 13,
      label: 'build release evidence pack',
      command: 'node',
      scriptPath: STEP_SCRIPTS.buildPack,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.buildPack),
      args: [
        '--release',
        release,
        '--consistency-dir',
        resolvedOutDir,
        '--evidence-dir',
        evidenceRoot,
        '--ao-gate-file',
        DEFAULT_AO_GATE_FILE,
        '--out',
        packMd,
        '--json-out',
        packJson,
        '--require-both',
        '--require-ao-gate',
      ],
      displayArgs: [
        '--release',
        release,
        '--consistency-dir',
        resolvedOutDir,
        '--evidence-dir',
        evidenceRoot,
        '--ao-gate-file',
        DEFAULT_AO_GATE_FILE,
        '--out',
        packMd,
        '--json-out',
        packJson,
        '--require-both',
        '--require-ao-gate',
      ],
      outputFiles: [packMd, packJson],
    },
    {
      id: 'build-checklist',
      index: 14,
      label: 'build release sign-off checklist',
      command: 'node',
      scriptPath: STEP_SCRIPTS.buildChecklist,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.buildChecklist),
      args: ['--pack', packJson, '--out', checklistMd],
      displayArgs: ['--pack', packJson, '--out', checklistMd],
      outputFile: checklistMd,
    },
    {
      id: 'readiness',
      index: 15,
      label: 'check release readiness',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkReadiness,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkReadiness),
      args: strict ? ['--pack', packJson, '--json', '--strict'] : ['--pack', packJson, '--json'],
      displayArgs: strict ? ['--pack', packJson, '--json', '--strict'] : ['--pack', packJson, '--json'],
      outputFile: readinessJson,
    },
    {
      id: 'build-drill-manifest',
      index: 16,
      label: 'build release drill manifest',
      command: 'node',
      scriptPath: STEP_SCRIPTS.buildDrillManifest,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.buildDrillManifest),
      args: ['--dir', resolvedOutDir, '--out', drillManifestJson],
      displayArgs: ['--dir', resolvedOutDir, '--out', drillManifestJson],
      outputFile: drillManifestJson,
    },
    {
      id: 'validate-drill-manifest',
      index: 17,
      label: 'validate release drill manifest',
      command: 'node',
      scriptPath: STEP_SCRIPTS.validateDrillManifest,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.validateDrillManifest),
      args: ['--file', drillManifestJson, '--strict'],
      displayArgs: ['--file', drillManifestJson, '--strict'],
      outputFile: drillManifestValidation,
    },
    {
      id: 'check-drill-artifacts',
      index: 18,
      label: 'check release drill artifacts',
      command: 'node',
      scriptPath: STEP_SCRIPTS.checkDrillArtifacts,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.checkDrillArtifacts),
      args: ['--dir', resolvedOutDir, '--strict', '--json'],
      displayArgs: ['--dir', resolvedOutDir, '--strict', '--json'],
      outputFile: drillCheckJson,
    },
    {
      id: 'build-ledger',
      index: 19,
      label: 'build release evidence ledger',
      command: 'node',
      scriptPath: STEP_SCRIPTS.buildLedger,
      displayScriptPath: relative(REPO_ROOT, STEP_SCRIPTS.buildLedger),
      args: strict
        ? ['--dir', resolvedOutDir, '--decision', 'pending', '--out', ledgerMd, '--json-out', ledgerJson, '--strict']
        : ['--dir', resolvedOutDir, '--decision', 'pending', '--out', ledgerMd, '--json-out', ledgerJson],
      displayArgs: strict
        ? ['--dir', resolvedOutDir, '--decision', 'pending', '--out', ledgerMd, '--json-out', ledgerJson, '--strict']
        : ['--dir', resolvedOutDir, '--decision', 'pending', '--out', ledgerMd, '--json-out', ledgerJson],
      outputFiles: [ledgerMd, ledgerJson],
    },
  ]

  return {
    outDir: resolvedOutDir,
    urls,
    release,
    profile,
    mode,
    tokenPresent: isNonEmptyString(token),
    allowAnon,
    strict,
    artifacts: {
      matrixJson,
      reportMd,
      summaryJson,
      evidenceRoot,
      latestBundleJson,
      aoGateValidationTxt,
      legacyCoreEvidenceJson,
      legacyCryptoEvidenceJson,
      templateWorkerMapCoherenceJson,
      forgetForwardConfigJson,
      templateSignatureRefMapJson,
      drillChecksJson,
      packMd,
      packJson,
      checklistMd,
      readinessJson,
      drillManifestJson,
      drillManifestValidation,
      drillCheckJson,
      ledgerMd,
      ledgerJson,
      aoGateFile: DEFAULT_AO_GATE_FILE,
    },
    templateWorkerMapCoherenceCheck,
    forgetForwardConfigCheck,
    templateSignatureRefMapCheck,
    steps,
  }
}

function formatDryRunPlan(plan) {
  const lines = []
  lines.push('Dry run: release drill')
  lines.push(`Out dir: ${plan.outDir}`)
  lines.push(`Release: ${plan.release}`)
  lines.push(`Profile: ${plan.profile}`)
  lines.push(`Mode: ${plan.mode}`)
  lines.push(`Auth: ${plan.tokenPresent ? 'token provided' : plan.allowAnon ? 'anonymous allowed' : 'token required'}`)
  lines.push(`Strict readiness: ${plan.strict ? 'yes' : 'no'}`)
  lines.push('')

  for (const step of plan.steps) {
    lines.push(`${step.index}) ${step.label}`)
    lines.push(`   ${formatCommand(step.command, [step.displayScriptPath, ...step.displayArgs])}`)
    if (step.outputFile) lines.push(`   -> ${step.outputFile}`)
    if (Array.isArray(step.outputFiles)) {
      for (const outputFile of step.outputFiles) lines.push(`   -> ${outputFile}`)
    }
    lines.push('')
  }

  lines.push(`Release drill metadata: ${plan.artifacts.drillChecksJson}`)
  lines.push(`AO gate file: ${plan.artifacts.aoGateFile}`)
  return `${lines.join('\n').trimEnd()}\n`
}

function normalizeChildExitCode(result) {
  if (result && typeof result.status === 'number') {
    if (result.status === 64) return 64
    return result.status === 0 ? 0 : 3
  }
  if (result && (result.error || result.signal)) return 3
  return 3
}

function writeTextFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function ensureFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} was not created: ${path}`)
}

function runChildStep(step, stepArgs, deps = {}) {
  const spawnSyncFn = deps.spawnSyncFn ?? spawnSync
  const env = step.env ? { ...process.env, ...step.env } : process.env
  return spawnSyncFn(process.execPath, [step.scriptPath, ...stepArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env,
  })
}

function runReleaseDrill(options = {}, deps = {}) {
  const plan = buildDrillPlan(options)
  const total = plan.steps.length
  const stdout = []
  const stderr = []
  const context = {
    latestBundleDir: '',
    legacyCoreEvidence: null,
    legacyCryptoEvidence: null,
    templateWorkerMapCoherence: null,
    forgetForwardConfig: null,
    templateSignatureRefMap: null,
  }

  if (options.dryRun) {
    return {
      exitCode: 0,
      stdout: formatDryRunPlan(plan),
      stderr: '',
      plan,
      artifacts: plan.artifacts,
    }
  }

  mkdirSync(plan.outDir, { recursive: true })

  for (const step of plan.steps) {
    const stepLine = stepLabel(step, total)
    const stepArgs = getStepArgs(step, context)
    stdout.push(`${stepLine}\n`)

    let child
    try {
      child = runChildStep(step, stepArgs, deps)
    } catch (err) {
      stderr.push(`${stepLine} failed to start: ${err instanceof Error ? err.message : String(err)}\n`)
      return { exitCode: 3, stdout: stdout.join(''), stderr: stderr.join(''), plan, artifacts: plan.artifacts }
    }

    const childStdout = typeof child.stdout === 'string' ? child.stdout : ''
    const childStderr = typeof child.stderr === 'string' ? child.stderr : ''
    if (childStdout) stdout.push(childStdout.endsWith('\n') ? childStdout : `${childStdout}\n`)
    if (childStderr) stderr.push(childStderr.endsWith('\n') ? childStderr : `${childStderr}\n`)

    const exitCode = normalizeChildExitCode(child)
    if (exitCode !== 0) {
      stderr.push(`${stepLine} failed with exit ${exitCode}\n`)
      return { exitCode, stdout: stdout.join(''), stderr: stderr.join(''), plan, artifacts: plan.artifacts }
    }

    try {
      if (step.id === 'compare') {
        const matrix = JSON.parse(childStdout || '{}')
        writeTextFile(plan.artifacts.matrixJson, `${JSON.stringify(matrix, null, 2)}\n`)
      }

      if (step.id === 'latest-bundle') {
        const latest = JSON.parse(childStdout || '{}')
        writeTextFile(plan.artifacts.latestBundleJson, `${JSON.stringify(latest, null, 2)}\n`)
        if (!isNonEmptyString(latest.bundleDir)) {
          throw new Error('latest bundle output is missing bundleDir')
        }
        context.latestBundleDir = latest.bundleDir.trim()
      }

      if (step.id === 'readiness') {
        const readiness = JSON.parse(childStdout || '{}')
        writeTextFile(plan.artifacts.readinessJson, `${JSON.stringify(readiness, null, 2)}\n`)
      }
      if (step.id === 'validate-ao-gate') {
        writeTextFile(plan.artifacts.aoGateValidationTxt, childStdout || `valid dependency gate: ${plan.artifacts.aoGateFile}\n`)
      }
      if (step.id === 'check-legacy-core-evidence') {
        const legacyCoreEvidence = JSON.parse(childStdout || '{}')
        context.legacyCoreEvidence = legacyCoreEvidence
        writeTextFile(plan.artifacts.legacyCoreEvidenceJson, `${JSON.stringify(legacyCoreEvidence, null, 2)}\n`)
      }
      if (step.id === 'check-legacy-crypto-evidence') {
        const legacyCryptoEvidence = JSON.parse(childStdout || '{}')
        context.legacyCryptoEvidence = legacyCryptoEvidence
        writeTextFile(plan.artifacts.legacyCryptoEvidenceJson, `${JSON.stringify(legacyCryptoEvidence, null, 2)}\n`)
      }
      if (step.id === 'check-template-worker-map-coherence') {
        const templateWorkerMapCoherence = JSON.parse(childStdout || '{}')
        context.templateWorkerMapCoherence = {
          configured: plan.templateWorkerMapCoherenceCheck.configured,
          ...templateWorkerMapCoherence,
        }
        writeTextFile(
          plan.artifacts.templateWorkerMapCoherenceJson,
          `${JSON.stringify(context.templateWorkerMapCoherence, null, 2)}\n`,
        )
      }
      if (step.id === 'check-forget-forward-config') {
        const forgetForwardConfig = JSON.parse(childStdout || '{}')
        context.forgetForwardConfig = forgetForwardConfig
        writeTextFile(plan.artifacts.forgetForwardConfigJson, `${JSON.stringify(forgetForwardConfig, null, 2)}\n`)
      }
      if (step.id === 'check-template-signature-ref-map') {
        const templateSignatureRefMap = JSON.parse(childStdout || '{}')
        context.templateSignatureRefMap = {
          configured: plan.templateSignatureRefMapCheck.configured,
          requiredSites: plan.templateSignatureRefMapCheck.requiredSites,
          ...templateSignatureRefMap,
        }
        writeTextFile(plan.artifacts.templateSignatureRefMapJson, `${JSON.stringify(context.templateSignatureRefMap, null, 2)}\n`)
        const drillChecks = {
          release: plan.release,
          profile: plan.profile,
          mode: plan.mode,
          strict: plan.strict,
          createdAt: new Date().toISOString(),
          legacyCoreExtractionEvidence: context.legacyCoreEvidence,
          legacyCryptoBoundaryEvidence: context.legacyCryptoEvidence,
          templateWorkerMapCoherence: context.templateWorkerMapCoherence,
          forgetForwardConfig: context.forgetForwardConfig,
          templateSignatureRefMap: context.templateSignatureRefMap,
        }
        writeTextFile(plan.artifacts.drillChecksJson, `${JSON.stringify(drillChecks, null, 2)}\n`)
      }
      if (step.id === 'validate-drill-manifest') {
        writeTextFile(plan.artifacts.drillManifestValidation, childStdout || 'valid release drill manifest\n')
      }
      if (step.id === 'check-drill-artifacts') {
        const drillCheck = JSON.parse(childStdout || '{}')
        writeTextFile(plan.artifacts.drillCheckJson, `${JSON.stringify(drillCheck, null, 2)}\n`)
      }
    } catch (err) {
      stderr.push(`${stepLine} failed to parse JSON output: ${err instanceof Error ? err.message : String(err)}\n`)
      return { exitCode: 3, stdout: stdout.join(''), stderr: stderr.join(''), plan, artifacts: plan.artifacts }
    }

    try {
      if (step.id === 'export-report') {
        ensureFile(plan.artifacts.reportMd, step.label)
        ensureFile(plan.artifacts.summaryJson, step.label)
      }
      if (step.id === 'latest-bundle') ensureFile(plan.artifacts.latestBundleJson, step.label)
      if (step.id === 'build-pack') {
        ensureFile(plan.artifacts.packMd, step.label)
        ensureFile(plan.artifacts.packJson, step.label)
      }
      if (step.id === 'validate-ao-gate') ensureFile(plan.artifacts.aoGateValidationTxt, step.label)
      if (step.id === 'check-legacy-core-evidence') ensureFile(plan.artifacts.legacyCoreEvidenceJson, step.label)
      if (step.id === 'check-legacy-crypto-evidence') ensureFile(plan.artifacts.legacyCryptoEvidenceJson, step.label)
      if (step.id === 'check-template-worker-map-coherence') ensureFile(plan.artifacts.templateWorkerMapCoherenceJson, step.label)
      if (step.id === 'check-forget-forward-config') ensureFile(plan.artifacts.forgetForwardConfigJson, step.label)
      if (step.id === 'check-template-signature-ref-map') {
        ensureFile(plan.artifacts.templateSignatureRefMapJson, step.label)
        ensureFile(plan.artifacts.drillChecksJson, 'release drill metadata')
      }
      if (step.id === 'build-checklist') ensureFile(plan.artifacts.checklistMd, step.label)
      if (step.id === 'readiness') ensureFile(plan.artifacts.readinessJson, step.label)
      if (step.id === 'build-drill-manifest') ensureFile(plan.artifacts.drillManifestJson, step.label)
      if (step.id === 'validate-drill-manifest') ensureFile(plan.artifacts.drillManifestValidation, step.label)
      if (step.id === 'check-drill-artifacts') ensureFile(plan.artifacts.drillCheckJson, step.label)
      if (step.id === 'build-ledger') {
        ensureFile(plan.artifacts.ledgerMd, step.label)
        ensureFile(plan.artifacts.ledgerJson, step.label)
      }
    } catch (err) {
      stderr.push(`${stepLine} failed: ${err instanceof Error ? err.message : String(err)}\n`)
      return { exitCode: 3, stdout: stdout.join(''), stderr: stderr.join(''), plan, artifacts: plan.artifacts }
    }

    stdout.push(`${stepLine} done\n`)
  }

  return {
    exitCode: 0,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    plan,
    artifacts: plan.artifacts,
  }
}

function runCli(argv = process.argv.slice(2), deps = {}) {
  try {
    const args = parseArgs(argv)
    if (args.help) return { exitCode: 0, stdout: usageText(), stderr: '' }
    return runReleaseDrill(args, deps)
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

export { CliError, buildDrillPlan, formatDryRunPlan, parseArgs, runCli, runReleaseDrill, usageText }
