#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_DIR = 'ops/decommission'
const DEFAULT_RELEASE = '1.4.0'
const DEFAULT_PROFILE = 'vps_medium'
const DEFAULT_MODE = 'pairwise'
const DEFAULT_LABEL = 'prelive'

const VALID_PROFILES = new Set(['vps_small', 'vps_medium', 'diskless'])
const VALID_MODES = new Set(['pairwise', 'all'])

const STEP_SCRIPTS = {
  exportConsistencyReport: resolve(SCRIPT_DIR, 'export-consistency-report.js'),
  latestEvidenceBundle: resolve(SCRIPT_DIR, 'latest-evidence-bundle.js'),
  validateAoGate: resolve(SCRIPT_DIR, 'validate-ao-dependency-gate.js'),
  buildReleaseEvidencePack: resolve(SCRIPT_DIR, 'build-release-evidence-pack.js'),
  buildReleaseSignoffChecklist: resolve(SCRIPT_DIR, 'build-release-signoff-checklist.js'),
  checkReleaseReadiness: resolve(SCRIPT_DIR, 'check-release-readiness.js'),
  buildReleaseDrillManifest: resolve(SCRIPT_DIR, 'build-release-drill-manifest.js'),
  validateReleaseDrillManifest: resolve(SCRIPT_DIR, 'validate-release-drill-manifest.js'),
  checkReleaseDrillArtifacts: resolve(SCRIPT_DIR, 'check-release-drill-artifacts.js'),
  buildReleaseEvidenceLedger: resolve(SCRIPT_DIR, 'build-release-evidence-ledger.js'),
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/bootstrap-prelive-decommission-artifacts.js [--dir <DIR>] [--release <VERSION>] [--profile vps_small|vps_medium|diskless] [--mode pairwise|all] [--label <TEXT>] [--ao-gate <FILE>] [--dry-run] [--help]',
    '',
    'Options:',
    `  --dir <DIR>        Target decommission dir (default: ${DEFAULT_DIR})`,
    `  --release <VER>    Release label (default: ${DEFAULT_RELEASE})`,
    `  --profile <NAME>   Profile for drift summary (default: ${DEFAULT_PROFILE})`,
    `  --mode <MODE>      Compare mode in generated matrix (default: ${DEFAULT_MODE})`,
    `  --label <TEXT>     Label suffix for seeded evidence bundle (default: ${DEFAULT_LABEL})`,
    '  --ao-gate <FILE>   AO gate file (default: <dir>/ao-dependency-gate.json)',
    '  --dry-run          Print plan only (no writes, no child scripts)',
    '  --help             Show this help',
    '',
    'Notes:',
    '- This is a pre-live bootstrap path for environments without active gateway endpoints.',
    '- It creates a deterministic baseline artifact set so closeout checks can split automation vs AO/manual blockers.',
    '- Final GO still requires AO gate closure and a live strict release drill.',
    '',
    'Exit codes:',
    '  0   success',
    '  3   runtime/data failure',
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
    dir: DEFAULT_DIR,
    release: DEFAULT_RELEASE,
    profile: DEFAULT_PROFILE,
    mode: DEFAULT_MODE,
    label: DEFAULT_LABEL,
    aoGate: '',
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') throw new CliError('help requested', 0)
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
      case '--release':
        args.release = readValue()
        break
      case '--profile':
        args.profile = readValue().trim().toLowerCase()
        break
      case '--mode':
        args.mode = readValue().trim().toLowerCase()
        break
      case '--label':
        args.label = readValue()
        break
      case '--ao-gate':
        args.aoGate = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir must not be blank', 64)
  if (!isNonEmptyString(args.release)) throw new CliError('--release must not be blank', 64)
  if (!VALID_PROFILES.has(args.profile)) throw new CliError(`unsupported profile: ${args.profile}`, 64)
  if (!VALID_MODES.has(args.mode)) throw new CliError(`unsupported mode: ${args.mode}`, 64)
  if (!isNonEmptyString(args.label)) throw new CliError('--label must not be blank', 64)

  args.dir = resolve(REPO_ROOT, args.dir)
  args.aoGate = isNonEmptyString(args.aoGate) ? resolve(REPO_ROOT, args.aoGate) : join(args.dir, 'ao-dependency-gate.json')

  return args
}

function timestampSlug(now = new Date()) {
  return now.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function writeText(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, payload.endsWith('\n') ? payload : `${payload}\n`, 'utf8')
}

function runNodeScript(scriptPath, scriptArgs, options = {}) {
  const child = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if ((typeof child.status === 'number' ? child.status : 1) !== 0) {
    const detail = [child.stdout, child.stderr].filter(isNonEmptyString).join('\n').trim()
    throw new Error(`step failed: ${scriptPath} ${scriptArgs.join(' ')}${detail ? `\n${detail}` : ''}`)
  }

  return (options.captureStdout ? child.stdout : '').trim()
}

function buildPlan(args) {
  const evidenceRoot = join(args.dir, 'evidence')
  const seededBundleDir = join(evidenceRoot, `${timestampSlug()}-${args.label}`)
  return {
    dir: args.dir,
    release: args.release,
    profile: args.profile,
    mode: args.mode,
    aoGate: args.aoGate,
    evidenceRoot,
    seededBundleDir,
    files: {
      matrix: join(args.dir, 'consistency-matrix.json'),
      driftReport: join(args.dir, 'consistency-drift-report.md'),
      driftSummary: join(args.dir, 'consistency-drift-summary.json'),
      latestBundle: join(args.dir, 'latest-evidence-bundle.json'),
      aoGateValidation: join(args.dir, 'ao-dependency-gate.validation.txt'),
      packMd: join(args.dir, 'release-evidence-pack.md'),
      packJson: join(args.dir, 'release-evidence-pack.json'),
      checklist: join(args.dir, 'release-signoff-checklist.md'),
      readiness: join(args.dir, 'release-readiness.json'),
      drillChecks: join(args.dir, 'release-drill-checks.json'),
      templateVariantMap: join(args.dir, 'template-variant-map.json'),
      drillManifest: join(args.dir, 'release-drill-manifest.json'),
      drillManifestValidation: join(args.dir, 'release-drill-manifest.validation.txt'),
      drillCheck: join(args.dir, 'release-drill-check.json'),
      ledgerMd: join(args.dir, 'release-evidence-ledger.md'),
      ledgerJson: join(args.dir, 'release-evidence-ledger.json'),
    },
  }
}

async function seedPreliveArtifacts(plan) {
  await mkdir(plan.dir, { recursive: true })
  await mkdir(plan.evidenceRoot, { recursive: true })
  await mkdir(plan.seededBundleDir, { recursive: true })

  const matrixPayload = {
    mode: plan.mode,
    counts: {
      total: 1,
      pass: 1,
      mismatch: 0,
      failure: 0,
    },
    runs: [
      {
        index: 1,
        name: 'prelive-baseline',
        status: 'PASS',
        outcome: 'pass',
        reason: 'Pre-live baseline artifact set (no live gateway endpoints yet)',
        labels: ['prelive-gateway-a', 'prelive-gateway-b'],
      },
    ],
  }
  await writeJson(plan.files.matrix, matrixPayload)

  await writeText(join(plan.seededBundleDir, 'compare.txt'), 'prelive evidence compare: PASS')
  await writeJson(join(plan.seededBundleDir, 'attestation.json'), {
    artifactType: 'gateway-integrity-attestation',
    scriptVersionTag: 'integrity-attestation-v1',
    generatedAt: new Date().toISOString(),
    gateways: ['https://prelive-gateway-a.invalid', 'https://prelive-gateway-b.invalid'],
    comparedFields: ['release', 'trustedRoot', 'policyPaused'],
    summary: { runs: 1, pass: 1, mismatch: 0, failure: 0 },
    // Pre-live placeholder: strict attestation verification is only required in live drills.
    digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  })
  await writeJson(join(plan.seededBundleDir, 'manifest.json'), {
    status: 'ok',
    urls: ['https://prelive-gateway-a.invalid', 'https://prelive-gateway-b.invalid'],
    compare: { exitCode: 0 },
    attestation: { exitCode: 0 },
    mode: 'prelive',
  })
  await writeJson(join(plan.evidenceRoot, 'attestation-exchange-pack.json'), {
    summary: {
      total: 1,
      ok: 1,
      failed: 0,
    },
    notes: 'Pre-live baseline exchange pack',
  })

  await writeJson(plan.files.templateVariantMap, {
    ok: true,
    status: 'complete',
    strict: true,
    envVar: 'GATEWAY_TEMPLATE_VARIANT_MAP',
    requiredSites: ['site-alpha', 'site-beta'],
    allowedVariants: ['signal', 'bastion', 'horizon'],
    providedSites: ['site-alpha', 'site-beta'],
    missingSites: [],
    counts: {
      providedCount: 2,
      requiredCount: 2,
      missingCount: 0,
    },
    issues: [],
    warnings: [],
    map: {
      'site-alpha': {
        variant: 'signal',
        templateTxId: 'prelive-template-alpha',
        manifestTxId: 'prelive-manifest-alpha',
      },
      'site-beta': {
        variant: 'bastion',
        templateTxId: 'prelive-template-beta',
        manifestTxId: 'prelive-manifest-beta',
      },
    },
  })
}

async function buildDrillChecksJson(plan) {
  const readJson = async (name) => JSON.parse(await readFile(join(plan.dir, name), 'utf8'))
  const pack = await readJson('release-evidence-pack.json')
  const readiness = await readJson('release-readiness.json')

  const payload = {
    createdAt: new Date().toISOString(),
    release: readiness.release || pack.release || plan.release,
    profile: plan.profile,
    mode: plan.mode,
    strict: false,
    legacyCoreExtractionEvidence: await readJson('legacy-core-extraction-evidence.json'),
    legacyCryptoBoundaryEvidence: await readJson('legacy-crypto-boundary-evidence.json'),
    templateWorkerMapCoherence: await readJson('template-worker-map-coherence.json'),
    forgetForwardConfig: await readJson('forget-forward-config.json'),
    templateSignatureRefMap: await readJson('template-signature-ref-map.json'),
    templateVariantMap: await readJson('template-variant-map.json'),
  }

  await writeJson(plan.files.drillChecks, payload)
}

async function executePlan(plan) {
  await seedPreliveArtifacts(plan)

  runNodeScript(STEP_SCRIPTS.exportConsistencyReport, [
    '--matrix',
    plan.files.matrix,
    '--out-dir',
    plan.dir,
    '--profile',
    plan.profile,
    '--prefix',
    'consistency',
  ])

  const latestBundleStdout = runNodeScript(
    STEP_SCRIPTS.latestEvidenceBundle,
    ['--root', plan.evidenceRoot, '--require-files', '--json'],
    { captureStdout: true },
  )
  await writeText(plan.files.latestBundle, latestBundleStdout)

  const gateValidationStdout = runNodeScript(
    STEP_SCRIPTS.validateAoGate,
    ['--file', plan.aoGate],
    { captureStdout: true },
  )
  await writeText(plan.files.aoGateValidation, gateValidationStdout)

  runNodeScript(STEP_SCRIPTS.buildReleaseEvidencePack, [
    '--release',
    plan.release,
    '--consistency-dir',
    plan.dir,
    '--evidence-dir',
    plan.evidenceRoot,
    '--ao-gate-file',
    plan.aoGate,
    '--out',
    plan.files.packMd,
    '--json-out',
    plan.files.packJson,
    '--require-both',
  ])

  runNodeScript(STEP_SCRIPTS.buildReleaseSignoffChecklist, [
    '--pack',
    plan.files.packJson,
    '--out',
    plan.files.checklist,
  ])

  const readinessStdout = runNodeScript(
    STEP_SCRIPTS.checkReleaseReadiness,
    ['--pack', plan.files.packJson, '--json'],
    { captureStdout: true },
  )
  await writeText(plan.files.readiness, readinessStdout)

  await buildDrillChecksJson(plan)

  runNodeScript(STEP_SCRIPTS.buildReleaseDrillManifest, ['--dir', plan.dir, '--out', plan.files.drillManifest])

  const drillManifestValidationStdout = runNodeScript(
    STEP_SCRIPTS.validateReleaseDrillManifest,
    ['--file', plan.files.drillManifest, '--strict'],
    { captureStdout: true },
  )
  await writeText(plan.files.drillManifestValidation, drillManifestValidationStdout)

  const drillCheckStdout = runNodeScript(
    STEP_SCRIPTS.checkReleaseDrillArtifacts,
    ['--dir', plan.dir, '--strict', '--json'],
    { captureStdout: true },
  )
  await writeText(plan.files.drillCheck, drillCheckStdout)

  runNodeScript(STEP_SCRIPTS.buildReleaseEvidenceLedger, [
    '--dir',
    plan.dir,
    '--decision',
    'pending',
    '--out',
    plan.files.ledgerMd,
    '--json-out',
    plan.files.ledgerJson,
  ])
}

async function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    const plan = buildPlan(args)

    if (args.dryRun) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ dryRun: true, ...plan }, null, 2)}\n`,
        stderr: '',
      }
    }

    await executePlan(plan)
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(
        {
          status: 'ok',
          mode: 'prelive-bootstrap',
          release: plan.release,
          dir: plan.dir,
          aoGate: plan.aoGate,
          evidenceRoot: plan.evidenceRoot,
          seededBundleDir: plan.seededBundleDir,
          files: plan.files,
        },
        null,
        2,
      )}\n`,
      stderr: '',
    }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.exitCode === 0) return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
      return { exitCode: err.exitCode, stdout: `${usageText()}\n`, stderr: `error: ${err.message}\n` }
    }
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
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
  main()
}

export { buildPlan, parseArgs, runCli, usageText }
