#!/usr/bin/env node

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_BUNDLE_FILES = ['compare.txt', 'attestation.json', 'manifest.json']
const TIMESTAMPED_DIR_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(?:-.+)?$/
const DEFAULT_REQUIRED_AO_CHECKS = [
  'p0_1_registry_contract_surface',
  'p1_1_authority_rotation_workflow',
  'p1_2_audit_commitments_stream',
]
const OPTIONAL_EVIDENCE_FILES = {
  coreExtraction: [
    'check-legacy-core-extraction-evidence.json',
    'legacy-core-extraction-evidence.json',
    'core-extraction-evidence.json',
  ],
  legacyCryptoBoundary: [
    'check-legacy-crypto-boundary-evidence.json',
    'legacy-crypto-boundary-evidence.json',
    'crypto-boundary-evidence.json',
  ],
  templateSignatureRefMap: [
    'check-template-signature-ref-map.json',
    'template-signature-ref-map.json',
    'signature-ref-map-check.json',
  ],
  templateWorkerMapCoherence: [
    'check-template-worker-map-coherence.json',
    'template-worker-map-coherence.json',
    'template-worker-routing-check.json',
  ],
  forgetForwardConfig: [
    'check-forget-forward-config.json',
    'forget-forward-config.json',
    'forget-forward-check.json',
  ],
}

const OPTIONAL_EVIDENCE_LABELS = {
  coreExtraction: 'core extraction evidence',
  legacyCryptoBoundary: 'legacy crypto boundary evidence',
  templateSignatureRefMap: 'template signature-ref map evidence',
  templateWorkerMapCoherence: 'template worker map coherence evidence',
  forgetForwardConfig: 'forget-forward config evidence',
}

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/build-release-evidence-pack.js [--release <VERSION>] [--consistency-dir <DIR>] [--evidence-dir <DIR>] [--ao-gate-file <FILE>] [--out <FILE>] [--json-out <FILE>] [--require-both] [--require-ao-gate]',
      '',
      'Options:',
      '  --release <VERSION>      Release label/version (default: 1.4.0)',
      '  --consistency-dir <DIR>  Directory with consistency-smoke artifacts',
      '  --evidence-dir <DIR>     Directory with evidence-dry-run artifacts',
      '  --ao-gate-file <FILE>    Machine-readable AO dependency gate JSON',
      '  --out <FILE>             Optional markdown output path',
      '  --json-out <FILE>        Optional JSON output path',
      '  --require-both           Exit non-zero when consistency or evidence data is missing',
      '  --require-ao-gate        Exit non-zero when AO dependency gate is missing or not closed',
      '  --json                   Print JSON summary to stdout (markdown is default)',
      '  --help                   Show this help',
      '',
      'Exit codes:',
      '  0   success',
      '  3   missing/invalid release evidence',
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

function parseArgs(argv) {
  const args = {
    release: '1.4.0',
    consistencyDir: '',
    evidenceDir: '',
    aoGateFile: '',
    out: '',
    jsonOut: '',
    requireBoth: false,
    requireAoGate: false,
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`, 64)
      i += 1
      return next
    }

    switch (arg) {
      case '--release':
        args.release = readValue()
        break
      case '--consistency-dir':
        args.consistencyDir = readValue()
        break
      case '--evidence-dir':
        args.evidenceDir = readValue()
        break
      case '--ao-gate-file':
        args.aoGateFile = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      case '--require-both':
        args.requireBoth = true
        break
      case '--require-ao-gate':
        args.requireAoGate = true
        break
      case '--json':
        args.json = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.release)) die('--release must not be blank', 64)
  if (args.aoGateFile && !isNonEmptyString(args.aoGateFile)) die('--ao-gate-file must not be blank', 64)
  if (args.out && !isNonEmptyString(args.out)) die('--out must not be blank', 64)
  if (args.jsonOut && !isNonEmptyString(args.jsonOut)) die('--json-out must not be blank', 64)
  if (!args.consistencyDir && !args.evidenceDir && !args.aoGateFile) {
    die('at least one of --consistency-dir, --evidence-dir, or --ao-gate-file is required', 64)
  }

  return args
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (_) {
    return false
  }
}

function parseTimestampFromDir(name) {
  const match = TIMESTAMPED_DIR_RE.exec(name)
  if (!match) return null
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return { iso, ms }
}

function normalizeAoStatus(value) {
  if (!isNonEmptyString(value)) return 'unknown'
  const status = value.trim().toLowerCase()
  switch (status) {
    case 'closed':
    case 'pass':
    case 'ok':
    case 'done':
      return 'closed'
    case 'open':
    case 'todo':
      return 'open'
    case 'in_progress':
    case 'in-progress':
    case 'progress':
      return 'in_progress'
    case 'blocked':
      return 'blocked'
    default:
      return status
  }
}

function normalizeRequiredAoChecks(value) {
  if (!Array.isArray(value)) return DEFAULT_REQUIRED_AO_CHECKS.slice()
  const out = []
  for (const item of value) {
    if (!isNonEmptyString(item)) continue
    const trimmed = item.trim()
    if (!out.includes(trimmed)) out.push(trimmed)
  }
  return out.length > 0 ? out : DEFAULT_REQUIRED_AO_CHECKS.slice()
}

function normalizeOptionalEvidenceStatus(value) {
  if (!isNonEmptyString(value)) return 'missing'
  const status = value.trim().toLowerCase()
  switch (status) {
    case 'pass':
    case 'complete':
    case 'closed':
    case 'ready':
    case 'ok':
      return 'pass'
    case 'warn':
    case 'warning':
    case 'pending':
    case 'issues-found':
    case 'issue':
    case 'issues':
      return 'warn'
    case 'fail':
    case 'blocked':
    case 'invalid':
      return 'fail'
    case 'missing':
      return 'missing'
    default:
      return status
  }
}

function summarizeCoreExtractionEvidence(payload, filePath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      present: true,
      status: 'invalid',
      reason: 'core extraction evidence payload must be a JSON object',
      filePath,
    }
  }

  const ok = payload.ok === true || payload.status === 'pass'
  if (ok) {
    return {
      present: true,
      status: 'pass',
      reason: 'all required runtime files, tests, and import scans passed',
      filePath,
    }
  }

  const runtimeMissingCount = Array.isArray(payload.runtimeMissing) ? payload.runtimeMissing.length : null
  const testMissingCount = Array.isArray(payload.testMissing) ? payload.testMissing.length : null
  const importFindingCount = Number.isInteger(payload.importFindingCount) ? payload.importFindingCount : null
  const scanIssue = isNonEmptyString(payload.importScan?.issue) ? payload.importScan.issue.trim() : ''
  const parts = []

  if (runtimeMissingCount !== null && runtimeMissingCount > 0) {
    parts.push(`${runtimeMissingCount} runtime file(s) missing`)
  }
  if (testMissingCount !== null && testMissingCount > 0) {
    parts.push(`${testMissingCount} test file(s) missing`)
  }
  if (importFindingCount !== null && importFindingCount > 0) {
    parts.push(`${importFindingCount} legacy import finding(s)`)
  }
  if (scanIssue) {
    parts.push(`scan issue: ${scanIssue}`)
  }
  if (parts.length === 0) {
    parts.push(`status=${isNonEmptyString(payload.status) ? payload.status.trim() : 'unknown'}`)
  }

  const strict = payload.strict === true
  return {
    present: true,
    status: strict ? 'fail' : 'warn',
    reason: parts.join(', '),
    filePath,
    runtimeMissingCount,
    testMissingCount,
    importFindingCount,
    strict,
  }
}

function summarizeLegacyCryptoBoundaryEvidence(payload, filePath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      present: true,
      status: 'invalid',
      reason: 'legacy crypto boundary evidence payload must be a JSON object',
      filePath,
    }
  }

  const ok = payload.ok === true || payload.status === 'pass'
  if (ok) {
    return {
      present: true,
      status: 'pass',
      reason: 'runtime crypto boundary is verification-only and legacy imports are absent',
      filePath,
    }
  }

  const runtimeMissingCount = Array.isArray(payload.runtimeMissing) ? payload.runtimeMissing.length : null
  const testMissingCount = Array.isArray(payload.testMissing) ? payload.testMissing.length : null
  const importFindingCount = Number.isInteger(payload.importFindingCount) ? payload.importFindingCount : null
  const forbiddenSigningFindingCount = Number.isInteger(payload.forbiddenSigningFindingCount)
    ? payload.forbiddenSigningFindingCount
    : null
  const scanIssue = isNonEmptyString(payload.importScan?.issue) ? payload.importScan.issue.trim() : ''
  const parts = []

  if (runtimeMissingCount !== null && runtimeMissingCount > 0) {
    parts.push(`${runtimeMissingCount} runtime file(s) missing`)
  }
  if (testMissingCount !== null && testMissingCount > 0) {
    parts.push(`${testMissingCount} test file(s) missing`)
  }
  if (importFindingCount !== null && importFindingCount > 0) {
    parts.push(`${importFindingCount} legacy import finding(s)`)
  }
  if (forbiddenSigningFindingCount !== null && forbiddenSigningFindingCount > 0) {
    parts.push(`${forbiddenSigningFindingCount} forbidden signing finding(s)`)
  }
  if (scanIssue) {
    parts.push(`scan issue: ${scanIssue}`)
  }
  if (parts.length === 0) {
    parts.push(`status=${isNonEmptyString(payload.status) ? payload.status.trim() : 'unknown'}`)
  }

  const strict = payload.strict === true
  return {
    present: true,
    status: strict ? 'fail' : 'warn',
    reason: parts.join(', '),
    filePath,
    runtimeMissingCount,
    testMissingCount,
    importFindingCount,
    forbiddenSigningFindingCount,
    strict,
  }
}

function summarizeTemplateSignatureRefMapEvidence(payload, filePath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      present: true,
      status: 'invalid',
      reason: 'template signature-ref map evidence payload must be a JSON object',
      filePath,
    }
  }

  const parsedStatus = normalizeOptionalEvidenceStatus(payload.status)
  const issues = Array.isArray(payload.issues) ? payload.issues.filter(isNonEmptyString).map((item) => item.trim()) : []
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(isNonEmptyString).map((item) => item.trim()) : []

  if (parsedStatus === 'pass' || payload.ok === true) {
    return {
      present: true,
      status: 'pass',
      reason: 'all required signature refs are present',
      filePath,
    }
  }

  const strict = payload.strict === true
  const missingSites = Array.isArray(payload.missingSites) ? payload.missingSites.filter(isNonEmptyString).map((item) => item.trim()) : []
  const parts = [...issues, ...warnings]
  if (missingSites.length > 0) {
    parts.unshift(`missing signature refs for: ${missingSites.join(', ')}`)
  }
  if (parts.length === 0) {
    parts.push(`status=${isNonEmptyString(payload.status) ? payload.status.trim() : 'unknown'}`)
  }

  return {
    present: true,
    status: strict || parsedStatus === 'fail' ? 'fail' : 'warn',
    reason: parts.join('; '),
    filePath,
    missingSites,
    strict,
  }
}

function summarizeTemplateWorkerMapCoherenceEvidence(payload, filePath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      present: true,
      status: 'invalid',
      reason: 'template worker map coherence evidence payload must be a JSON object',
      filePath,
    }
  }

  const parsedStatus = normalizeOptionalEvidenceStatus(payload.status)
  const issues = Array.isArray(payload.issues) ? payload.issues.filter(isNonEmptyString).map((item) => item.trim()) : []
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(isNonEmptyString).map((item) => item.trim()) : []
  const urlMapCount =
    payload?.counts && Number.isInteger(payload.counts.urlMapCount) && payload.counts.urlMapCount >= 0
      ? payload.counts.urlMapCount
      : 0
  const configured = payload.configured === true || urlMapCount > 0

  if (parsedStatus === 'pass' || payload.ok === true) {
    return {
      present: true,
      status: 'pass',
      reason: 'template worker URL/token/signatureRef maps are coherent',
      filePath,
      configured,
      urlMapCount,
    }
  }

  if (parsedStatus === 'warn' && !configured && issues.length === 0) {
    return {
      present: true,
      status: 'pass',
      reason: 'template worker routing map is not configured yet (pre-spawn baseline)',
      filePath,
      configured,
      urlMapCount,
    }
  }

  const strict = payload.strict === true
  const parts = [...issues, ...warnings]
  if (parts.length === 0) {
    parts.push(`status=${isNonEmptyString(payload.status) ? payload.status.trim() : 'unknown'}`)
  }

  return {
    present: true,
    status: strict || parsedStatus === 'fail' ? 'fail' : 'warn',
    reason: parts.join('; '),
    filePath,
    configured,
    urlMapCount,
    strict,
  }
}

function summarizeForgetForwardConfigEvidence(payload, filePath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      present: true,
      status: 'invalid',
      reason: 'forget-forward config evidence payload must be a JSON object',
      filePath,
    }
  }

  const parsedStatus = normalizeOptionalEvidenceStatus(payload.status)
  const issues = Array.isArray(payload.issues) ? payload.issues.filter(isNonEmptyString).map((item) => item.trim()) : []
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(isNonEmptyString).map((item) => item.trim()) : []
  const forwardUrl = isNonEmptyString(payload?.values?.url) ? payload.values.url.trim() : ''
  const relayConfigured = forwardUrl.length > 0

  if (parsedStatus === 'pass' || payload.ok === true) {
    return {
      present: true,
      status: 'pass',
      reason: relayConfigured
        ? 'forget-forward relay config is valid'
        : 'forget-forward relay is disabled (optional)',
      filePath,
      relayConfigured,
    }
  }

  if (parsedStatus === 'warn' && !relayConfigured && issues.length === 0) {
    return {
      present: true,
      status: 'pass',
      reason: 'forget-forward relay is disabled (optional)',
      filePath,
      relayConfigured,
    }
  }

  const strict = payload.strict === true
  const parts = [...issues, ...warnings]
  if (parts.length === 0) {
    parts.push(`status=${isNonEmptyString(payload.status) ? payload.status.trim() : 'unknown'}`)
  }

  return {
    present: true,
    status: strict || parsedStatus === 'fail' ? 'fail' : 'warn',
    reason: parts.join('; '),
    filePath,
    relayConfigured,
    strict,
  }
}

async function findFirstExistingFileByNames(rootDir, fileNames) {
  for (const fileName of fileNames) {
    const found = await findFileByName(rootDir, fileName)
    if (found) return found
  }
  return ''
}

async function findFileByName(rootDir, fileName) {
  const root = resolve(rootDir)
  if (!(await pathExists(root))) return ''

  const direct = join(root, fileName)
  if (await pathExists(direct)) return direct

  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, fileName)
    if (await pathExists(candidate)) return candidate
  }
  return ''
}

async function collectOptionalEvidenceArtifacts(rootDir) {
  if (!rootDir) {
    return {
      coreExtraction: { present: false, status: 'missing', reason: 'not provided', files: {} },
      legacyCryptoBoundary: { present: false, status: 'missing', reason: 'not provided', files: {} },
      templateSignatureRefMap: { present: false, status: 'missing', reason: 'not provided', files: {} },
      templateWorkerMapCoherence: { present: false, status: 'missing', reason: 'not provided', files: {} },
      forgetForwardConfig: { present: false, status: 'missing', reason: 'not provided', files: {} },
    }
  }

  const root = resolve(rootDir)
  const coreExtractionFile = await findFirstExistingFileByNames(root, OPTIONAL_EVIDENCE_FILES.coreExtraction)
  const legacyCryptoBoundaryFile = await findFirstExistingFileByNames(root, OPTIONAL_EVIDENCE_FILES.legacyCryptoBoundary)
  const signatureRefMapFile = await findFirstExistingFileByNames(root, OPTIONAL_EVIDENCE_FILES.templateSignatureRefMap)
  const templateWorkerMapCoherenceFile = await findFirstExistingFileByNames(
    root,
    OPTIONAL_EVIDENCE_FILES.templateWorkerMapCoherence,
  )
  const forgetForwardConfigFile = await findFirstExistingFileByNames(root, OPTIONAL_EVIDENCE_FILES.forgetForwardConfig)

  const coreExtraction = await (async () => {
    if (!coreExtractionFile) {
      return {
        present: false,
        status: 'missing',
        reason: 'artifact file not found',
        filePath: '',
        files: {},
      }
    }

    try {
      const payload = await readJson(coreExtractionFile)
      return summarizeCoreExtractionEvidence(payload, coreExtractionFile)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        filePath: coreExtractionFile,
      }
    }
  })()

  const templateSignatureRefMap = await (async () => {
    if (!signatureRefMapFile) {
      return {
        present: false,
        status: 'missing',
        reason: 'artifact file not found',
        filePath: '',
        files: {},
      }
    }

    try {
      const payload = await readJson(signatureRefMapFile)
      return summarizeTemplateSignatureRefMapEvidence(payload, signatureRefMapFile)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        filePath: signatureRefMapFile,
      }
    }
  })()

  const legacyCryptoBoundary = await (async () => {
    if (!legacyCryptoBoundaryFile) {
      return {
        present: false,
        status: 'missing',
        reason: 'artifact file not found',
        filePath: '',
        files: {},
      }
    }

    try {
      const payload = await readJson(legacyCryptoBoundaryFile)
      return summarizeLegacyCryptoBoundaryEvidence(payload, legacyCryptoBoundaryFile)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        filePath: legacyCryptoBoundaryFile,
      }
    }
  })()

  const templateWorkerMapCoherence = await (async () => {
    if (!templateWorkerMapCoherenceFile) {
      return {
        present: false,
        status: 'missing',
        reason: 'artifact file not found',
        filePath: '',
        files: {},
      }
    }

    try {
      const payload = await readJson(templateWorkerMapCoherenceFile)
      return summarizeTemplateWorkerMapCoherenceEvidence(payload, templateWorkerMapCoherenceFile)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        filePath: templateWorkerMapCoherenceFile,
      }
    }
  })()

  const forgetForwardConfig = await (async () => {
    if (!forgetForwardConfigFile) {
      return {
        present: false,
        status: 'missing',
        reason: 'artifact file not found',
        filePath: '',
        files: {},
      }
    }

    try {
      const payload = await readJson(forgetForwardConfigFile)
      return summarizeForgetForwardConfigEvidence(payload, forgetForwardConfigFile)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        filePath: forgetForwardConfigFile,
      }
    }
  })()

  return {
    coreExtraction,
    legacyCryptoBoundary,
    templateSignatureRefMap,
    templateWorkerMapCoherence,
    forgetForwardConfig,
  }
}

function resolveConsistencyStatus(matrix) {
  const counts = matrix?.counts
  if (!counts || typeof counts !== 'object') return { status: 'invalid', reason: 'missing counts' }
  const mismatch = Number.isInteger(counts.mismatch) ? counts.mismatch : 0
  const failure = Number.isInteger(counts.failure) ? counts.failure : 0
  if (failure > 0) return { status: 'fail', reason: `${failure} failure run(s)` }
  if (mismatch > 0) return { status: 'warn', reason: `${mismatch} mismatch run(s)` }
  return { status: 'pass', reason: 'all runs matched' }
}

async function collectConsistencyEvidence(rootDir) {
  if (!rootDir) {
    return { present: false, status: 'missing', reason: 'not provided', files: {} }
  }

  const matrixFile = await findFileByName(rootDir, 'consistency-matrix.json')
  const summaryFile = await findFileByName(rootDir, 'consistency-drift-summary.json')
  const reportFile = await findFileByName(rootDir, 'consistency-drift-report.md')

  if (!matrixFile && !summaryFile && !reportFile) {
    return { present: false, status: 'missing', reason: 'artifact files not found', files: {} }
  }

  let matrix = null
  let summary = null
  try {
    if (matrixFile) matrix = await readJson(matrixFile)
    if (summaryFile) summary = await readJson(summaryFile)
  } catch (err) {
    return {
      present: true,
      status: 'invalid',
      reason: err instanceof Error ? err.message : String(err),
      files: { matrixFile, summaryFile, reportFile },
    }
  }

  const fromMatrix = matrix ? resolveConsistencyStatus(matrix) : null
  const fromSummary =
    summary && isNonEmptyString(summary.status)
      ? {
          status:
            summary.status === 'critical'
              ? 'fail'
              : summary.status === 'warning'
                ? 'warn'
                : summary.status === 'ok'
                  ? 'pass'
                  : 'invalid',
          reason: `summary status=${summary.status}`,
        }
      : null

  const status = fromMatrix?.status || fromSummary?.status || 'invalid'
  const reason = fromMatrix?.reason || fromSummary?.reason || 'missing status markers'

  return {
    present: true,
    status,
    reason,
    files: { matrixFile, summaryFile, reportFile },
    counts: matrix?.counts || summary?.counts || null,
  }
}

async function findLatestBundleDir(rootDir) {
  const root = resolve(rootDir)
  if (!(await pathExists(root))) return ''
  const entries = await readdir(root, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseTimestampFromDir(entry.name)
    if (!parsed) continue
    candidates.push({ dir: join(root, entry.name), ms: parsed.ms, name: entry.name })
  }
  if (!candidates.length) return ''
  candidates.sort((a, b) => (a.ms === b.ms ? a.name.localeCompare(b.name) : a.ms - b.ms))
  return candidates[candidates.length - 1].dir
}

async function collectEvidenceBundle(rootDir) {
  if (!rootDir) {
    return { present: false, status: 'missing', reason: 'not provided', latestBundleDir: '', files: {} }
  }

  const latestBundleDir = await findLatestBundleDir(rootDir)
  const exchangePackFile = await findFileByName(rootDir, 'attestation-exchange-pack.json')

  if (!latestBundleDir) {
    return {
      present: false,
      status: 'missing',
      reason: 'no timestamped bundle directory found',
      latestBundleDir: '',
      files: { exchangePackFile },
    }
  }

  const fileMap = {
    comparePath: join(latestBundleDir, 'compare.txt'),
    attestationPath: join(latestBundleDir, 'attestation.json'),
    manifestPath: join(latestBundleDir, 'manifest.json'),
    exchangePackFile,
  }

  const missing = []
  for (const fileName of REQUIRED_BUNDLE_FILES) {
    const path = join(latestBundleDir, fileName)
    if (!(await pathExists(path))) missing.push(fileName)
  }

  let manifest = null
  if (!missing.length) {
    try {
      manifest = await readJson(fileMap.manifestPath)
    } catch (err) {
      return {
        present: true,
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
        latestBundleDir,
        files: fileMap,
      }
    }
  }

  let exchangeSummary = null
  if (exchangePackFile) {
    try {
      const exchangePack = await readJson(exchangePackFile)
      exchangeSummary = exchangePack?.summary || null
    } catch (_) {
      exchangeSummary = null
    }
  }

  if (missing.length) {
    return {
      present: true,
      status: 'invalid',
      reason: `missing required bundle files: ${missing.join(', ')}`,
      latestBundleDir,
      files: fileMap,
    }
  }

  const manifestStatus = manifest?.status
  const compareExit = manifest?.compare?.exitCode
  const attestationExit = manifest?.attestation?.exitCode
  const isPass = manifestStatus === 'ok' && compareExit === 0 && attestationExit === 0

  return {
    present: true,
    status: isPass ? 'pass' : 'fail',
    reason: isPass
      ? 'latest bundle strict markers are ok'
      : `manifest status=${manifestStatus ?? 'unknown'}, compare=${compareExit ?? 'n/a'}, attestation=${attestationExit ?? 'n/a'}`,
    latestBundleDir,
    files: fileMap,
    manifestStatus: manifestStatus ?? 'unknown',
    compareExit: Number.isInteger(compareExit) ? compareExit : null,
    attestationExit: Number.isInteger(attestationExit) ? attestationExit : null,
    exchangeSummary,
  }
}

async function collectAoDependencyGate(filePath) {
  if (!filePath) {
    return { present: false, status: 'missing', reason: 'not provided', filePath: '', required: [], checks: [] }
  }

  const resolved = resolve(filePath)
  if (!(await pathExists(resolved))) {
    return {
      present: false,
      status: 'missing',
      reason: 'ao gate file not found',
      filePath: resolved,
      required: [],
      checks: [],
    }
  }

  let payload
  try {
    payload = await readJson(resolved)
  } catch (err) {
    return {
      present: true,
      status: 'invalid',
      reason: err instanceof Error ? err.message : String(err),
      filePath: resolved,
      required: [],
      checks: [],
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      present: true,
      status: 'invalid',
      reason: 'ao gate payload must be a JSON object',
      filePath: resolved,
      required: [],
      checks: [],
    }
  }

  const required = normalizeRequiredAoChecks(payload.required)
  const checksRaw = Array.isArray(payload.checks) ? payload.checks : []
  const checks = checksRaw
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: isNonEmptyString(entry.id) ? entry.id.trim() : '',
      title: isNonEmptyString(entry.title) ? entry.title.trim() : '',
      status: normalizeAoStatus(entry.status),
      evidence: isNonEmptyString(entry.evidence) ? entry.evidence.trim() : '',
      notes: isNonEmptyString(entry.notes) ? entry.notes.trim() : '',
    }))
    .filter((entry) => isNonEmptyString(entry.id))

  const checksById = new Map(checks.map((entry) => [entry.id, entry]))
  const requiredChecks = required.map((id) => {
    const found = checksById.get(id)
    if (!found) {
      return { id, title: '', status: 'missing', evidence: '', notes: '' }
    }
    return found
  })

  const notClosed = requiredChecks.filter((entry) => entry.status !== 'closed')
  const status = notClosed.length === 0 ? 'pass' : 'fail'
  const reason =
    status === 'pass'
      ? 'all required AO dependency checks are closed'
      : `${notClosed.length} required AO check(s) not closed`

  return {
    present: true,
    status,
    reason,
    filePath: resolved,
    required,
    checks,
    requiredChecks,
  }
}

function combineReadiness(consistency, evidence, aoGate, requireBoth, requireAoGate) {
  const blockers = []
  const warnings = []

  if (!consistency.present) {
    if (requireBoth) blockers.push(`consistency evidence missing: ${consistency.reason}`)
    else warnings.push(`consistency evidence missing: ${consistency.reason}`)
  } else if (consistency.status === 'fail' || consistency.status === 'invalid') {
    blockers.push(`consistency status=${consistency.status}: ${consistency.reason}`)
  } else if (consistency.status === 'warn') {
    warnings.push(`consistency warning: ${consistency.reason}`)
  }

  if (!evidence.present) {
    if (requireBoth) blockers.push(`evidence bundle missing: ${evidence.reason}`)
    else warnings.push(`evidence bundle missing: ${evidence.reason}`)
  } else if (evidence.status !== 'pass') {
    blockers.push(`evidence status=${evidence.status}: ${evidence.reason}`)
  }

  if (!aoGate.present) {
    if (requireAoGate) blockers.push(`ao dependency gate missing: ${aoGate.reason}`)
    else warnings.push(`ao dependency gate missing: ${aoGate.reason}`)
  } else if (aoGate.status !== 'pass') {
    blockers.push(`ao dependency gate status=${aoGate.status}: ${aoGate.reason}`)
  }

  const status = blockers.length > 0 ? 'not-ready' : warnings.length > 0 ? 'warning' : 'ready'
  return { status, blockers, warnings }
}

function combineOptionalEvidenceSignals(optionalEvidence) {
  const blockers = []
  const warnings = []

  for (const [key, entry] of Object.entries(optionalEvidence || {})) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.present === false) continue

    const label = OPTIONAL_EVIDENCE_LABELS[key] || `${key} evidence`
    if (entry.status === 'invalid') {
      blockers.push(`${label} invalid JSON: ${entry.reason}`)
      continue
    }

    if (entry.status !== 'pass') {
      warnings.push(`${label} status=${entry.status}: ${entry.reason}`)
    }
  }

  return { blockers, warnings }
}

function renderMarkdown(pack) {
  const lines = []
  lines.push('# Release Evidence Pack')
  lines.push('')
  lines.push(`- Release: ${pack.release}`)
  lines.push(`- Generated: ${pack.createdAt}`)
  lines.push(`- Status: **${pack.status.toUpperCase()}**`)
  lines.push('')

  lines.push('## Consistency')
  lines.push(`- Present: ${pack.consistency.present ? 'yes' : 'no'}`)
  lines.push(`- Status: ${pack.consistency.status}`)
  lines.push(`- Reason: ${pack.consistency.reason}`)
  if (pack.consistency.counts) {
    lines.push(
      `- Counts: total=${pack.consistency.counts.total ?? 'n/a'}, pass=${pack.consistency.counts.pass ?? 'n/a'}, mismatch=${pack.consistency.counts.mismatch ?? 'n/a'}, failure=${pack.consistency.counts.failure ?? 'n/a'}`,
    )
  }
  if (pack.consistency.files?.reportFile) {
    lines.push(`- Drift report: ${pack.consistency.files.reportFile}`)
  }
  lines.push('')

  lines.push('## Evidence bundle')
  lines.push(`- Present: ${pack.evidence.present ? 'yes' : 'no'}`)
  lines.push(`- Status: ${pack.evidence.status}`)
  lines.push(`- Reason: ${pack.evidence.reason}`)
  if (pack.evidence.latestBundleDir) {
    lines.push(`- Latest bundle: ${pack.evidence.latestBundleDir}`)
  }
  if (pack.evidence.files?.exchangePackFile) {
    lines.push(`- Exchange pack: ${pack.evidence.files.exchangePackFile}`)
  }
  lines.push('')

  lines.push('## AO dependency gate')
  lines.push(`- Present: ${pack.aoGate.present ? 'yes' : 'no'}`)
  lines.push(`- Status: ${pack.aoGate.status}`)
  lines.push(`- Reason: ${pack.aoGate.reason}`)
  if (pack.aoGate.filePath) {
    lines.push(`- Gate file: ${pack.aoGate.filePath}`)
  }
  if (Array.isArray(pack.aoGate.requiredChecks) && pack.aoGate.requiredChecks.length > 0) {
    lines.push('- Required checks:')
    for (const check of pack.aoGate.requiredChecks) {
      const title = check.title ? ` (${check.title})` : ''
      const evidence = check.evidence ? ` [evidence: ${check.evidence}]` : ''
      lines.push(`  - ${check.id}${title}: ${check.status}${evidence}`)
    }
  }
  lines.push('')

  lines.push('## Optional evidence')
  const optionalEvidenceEntries = [
    ['Core extraction evidence', pack.optionalEvidence?.coreExtraction],
    ['Legacy crypto boundary evidence', pack.optionalEvidence?.legacyCryptoBoundary],
    ['Template signature-ref map evidence', pack.optionalEvidence?.templateSignatureRefMap],
    ['Template worker map coherence evidence', pack.optionalEvidence?.templateWorkerMapCoherence],
    ['Forget-forward config evidence', pack.optionalEvidence?.forgetForwardConfig],
  ]
  for (const [label, entry] of optionalEvidenceEntries) {
    lines.push(`- ${label}:`)
    lines.push(`  - Present: ${entry?.present ? 'yes' : 'no'}`)
    lines.push(`  - Status: ${entry?.status ?? 'missing'}`)
    lines.push(`  - Reason: ${entry?.reason ?? 'not provided'}`)
    if (entry?.filePath) lines.push(`  - File: ${entry.filePath}`)
  }
  lines.push('')

  if (pack.blockers.length > 0) {
    lines.push('## Blockers')
    for (const blocker of pack.blockers) lines.push(`- ${blocker}`)
    lines.push('')
  }

  if (pack.warnings.length > 0) {
    lines.push('## Warnings')
    for (const warning of pack.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }

  lines.push('## Sign-off hints')
  lines.push('- Attach this pack with consistency and evidence artifacts to the release PR.')
  lines.push('- Ensure AO-side registry/authority/audit dependencies are closed before final merge.')
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function buildReleaseEvidencePack(args) {
  const consistency = await collectConsistencyEvidence(args.consistencyDir)
  const evidence = await collectEvidenceBundle(args.evidenceDir)
  const aoGate = await collectAoDependencyGate(args.aoGateFile)
  const optionalEvidence = await collectOptionalEvidenceArtifacts(args.consistencyDir)
  const readiness = combineReadiness(consistency, evidence, aoGate, args.requireBoth, args.requireAoGate)
  const optionalSignals = combineOptionalEvidenceSignals(optionalEvidence)

  readiness.blockers.push(...optionalSignals.blockers)
  readiness.warnings.push(...optionalSignals.warnings)
  readiness.status = readiness.blockers.length > 0 ? 'not-ready' : readiness.warnings.length > 0 ? 'warning' : 'ready'

  const pack = {
    createdAt: new Date().toISOString(),
    release: args.release,
    status: readiness.status,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    consistency,
    evidence,
    aoGate,
    optionalEvidence,
  }

  return {
    pack,
    markdown: renderMarkdown(pack),
    readiness,
  }
}

async function writeText(path, content) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const { pack, markdown } = await buildReleaseEvidencePack(args)
  if (args.out) await writeText(args.out, markdown)
  if (args.jsonOut) await writeText(args.jsonOut, `${JSON.stringify(pack, null, 2)}\n`)

  process.stdout.write(args.json ? `${JSON.stringify(pack, null, 2)}\n` : markdown)
  if (pack.status === 'not-ready') process.exit(3)
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
  buildReleaseEvidencePack,
  combineReadiness,
  collectAoDependencyGate,
  collectOptionalEvidenceArtifacts,
  normalizeAoStatus,
  parseArgs,
  parseTimestampFromDir,
  renderMarkdown,
  resolveConsistencyStatus,
  runCli,
}
