#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { REQUIRED_ARTIFACTS as DRILL_MANIFEST_REQUIRED_ARTIFACTS } from './build-release-drill-manifest.js'
import { RELEASE_DRILL_STRICT_ARTIFACT_REQUIREMENTS } from './run-release-drill.js'

const REQUIRED_ARTIFACTS = RELEASE_DRILL_STRICT_ARTIFACT_REQUIREMENTS.map((entry) => ({
  key: entry.key,
  file: entry.file,
  aliases: Array.isArray(entry.aliases) ? [...entry.aliases] : [],
}))
const REQUIRED_FILES = REQUIRED_ARTIFACTS.map((entry) => entry.file)
const DRILL_CHECK_EMBEDDED_JSON_FIELDS = Object.freeze([
  {
    field: 'legacyCoreExtractionEvidence',
    artifact: 'legacy-core-extraction-evidence.json',
  },
  {
    field: 'legacyCryptoBoundaryEvidence',
    artifact: 'legacy-crypto-boundary-evidence.json',
  },
  {
    field: 'templateWorkerMapCoherence',
    artifact: 'template-worker-map-coherence.json',
  },
  {
    field: 'forgetForwardConfig',
    artifact: 'forget-forward-config.json',
  },
  {
    field: 'templateSignatureRefMap',
    artifact: 'template-signature-ref-map.json',
  },
  {
    field: 'templateVariantMap',
    artifact: 'template-variant-map.json',
  },
])

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
    '  node scripts/check-release-drill-artifacts.js --dir <DIR> [--strict] [--json] [--help]',
    '',
    'Options:',
    '  --dir <DIR>   Release-drill artifact directory (required)',
    '  --strict      Run deep cross-file consistency checks',
    '  --json        Print JSON output (human text by default)',
    '  --help        Show this help',
    '',
    'Exit codes:',
    '  0   artifact set is valid',
    '  3   missing or invalid drill artifacts',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    dir: '',
    strict: false,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }
    if (arg === '--strict') {
      args.strict = true
      continue
    }
    if (arg === '--json') {
      args.json = true
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
      case '--dir':
        args.dir = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir is required', 64)
  return args
}

function safeReadJson(path, label, issues) {
  try {
    const content = readFileSync(path, 'utf8')
    return JSON.parse(content)
  } catch (_) {
    issues.push(`${label} is not valid JSON`)
    return null
  }
}

function safeReadText(path, label, issues) {
  try {
    return readFileSync(path, 'utf8')
  } catch (_) {
    issues.push(`${label} is unreadable`)
    return ''
  }
}

function resolveRequiredArtifact(dir, requirement) {
  const candidateNames = [requirement.file, ...(Array.isArray(requirement.aliases) ? requirement.aliases : [])]
  for (const candidateName of candidateNames) {
    const candidatePath = join(dir, candidateName)
    try {
      const info = statSync(candidatePath)
      if (!info.isFile()) continue
      return {
        key: requirement.key,
        name: requirement.file,
        actualName: candidateName,
        usedAlias: candidateName !== requirement.file,
        path: candidatePath,
        sizeBytes: info.size,
      }
    } catch (_) {
      // Continue to next candidate
    }
  }

  return null
}

function resolveArtifactPath(dir, filesByCanonicalName, canonicalName) {
  return filesByCanonicalName.get(canonicalName)?.path ?? join(dir, canonicalName)
}

function validateManifestArtifacts(manifest, issues) {
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    issues.push('release-drill-manifest.json is missing artifacts[]')
    return
  }

  const manifestPaths = []
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) || !isNonEmptyString(artifact.path)) {
      issues.push('release-drill-manifest.json artifacts[] entries must include non-empty path values')
      continue
    }
    manifestPaths.push(artifact.path.trim())
  }

  const duplicates = []
  const seenPaths = new Set()
  for (const path of manifestPaths) {
    if (seenPaths.has(path)) duplicates.push(path)
    seenPaths.add(path)
  }
  if (duplicates.length > 0) {
    issues.push(`release-drill-manifest.json has duplicate artifact path entries: ${duplicates.join(', ')}`)
  }

  const expectedPaths = DRILL_MANIFEST_REQUIRED_ARTIFACTS
  const expectedSet = new Set(expectedPaths)
  const missingPaths = expectedPaths.filter((path) => !seenPaths.has(path))
  const unexpectedPaths = manifestPaths.filter((path) => !expectedSet.has(path))

  if (missingPaths.length > 0) {
    issues.push(`release-drill-manifest.json is missing expected artifact paths: ${missingPaths.join(', ')}`)
  }
  if (unexpectedPaths.length > 0) {
    issues.push(`release-drill-manifest.json has unexpected artifact paths: ${unexpectedPaths.join(', ')}`)
  }

  if (missingPaths.length === 0 && unexpectedPaths.length === 0 && manifestPaths.length === expectedPaths.length) {
    const orderMatches = expectedPaths.every((path, index) => path === manifestPaths[index])
    if (!orderMatches) {
      issues.push('release-drill-manifest.json artifact path order is non-deterministic')
    }
  }
}

function validateStrict(summary, strictChecks, filesByCanonicalName) {
  const { dir, issues } = summary
  const manifestPath = resolveArtifactPath(dir, filesByCanonicalName, 'release-drill-manifest.json')
  const readinessPath = resolveArtifactPath(dir, filesByCanonicalName, 'release-readiness.json')
  const packPath = resolveArtifactPath(dir, filesByCanonicalName, 'release-evidence-pack.json')
  const drillChecksPath = resolveArtifactPath(dir, filesByCanonicalName, 'release-drill-checks.json')
  const validationPath = resolveArtifactPath(dir, filesByCanonicalName, 'release-drill-manifest.validation.txt')
  const aoGateValidationPath = resolveArtifactPath(dir, filesByCanonicalName, 'ao-dependency-gate.validation.txt')

  const manifest = safeReadJson(manifestPath, 'release-drill-manifest.json', issues)
  const readiness = safeReadJson(readinessPath, 'release-readiness.json', issues)
  const pack = safeReadJson(packPath, 'release-evidence-pack.json', issues)
  const drillChecks = safeReadJson(drillChecksPath, 'release-drill-checks.json', issues)

  if (manifest) {
    if (!isNonEmptyString(manifest.release)) issues.push('release-drill-manifest.json is missing non-empty release')
    if (!isNonEmptyString(manifest.status)) issues.push('release-drill-manifest.json is missing non-empty status')
    validateManifestArtifacts(manifest, issues)
  }

  if (drillChecks) {
    if (!isNonEmptyString(drillChecks.release)) issues.push('release-drill-checks.json is missing non-empty release')
    if (!isNonEmptyString(drillChecks.profile)) issues.push('release-drill-checks.json is missing non-empty profile')
    if (!isNonEmptyString(drillChecks.mode)) issues.push('release-drill-checks.json is missing non-empty mode')
    if (typeof drillChecks.strict !== 'boolean') issues.push('release-drill-checks.json is missing strict boolean')
  }

  const readinessRelease = readiness && isNonEmptyString(readiness.release) ? readiness.release.trim() : ''
  const packRelease = pack && isNonEmptyString(pack.release) ? pack.release.trim() : ''
  const manifestRelease = manifest && isNonEmptyString(manifest.release) ? manifest.release.trim() : ''
  const drillChecksRelease = drillChecks && isNonEmptyString(drillChecks.release) ? drillChecks.release.trim() : ''

  if (readinessRelease && packRelease) {
    if (readinessRelease && packRelease && readinessRelease !== packRelease) {
      issues.push(`release mismatch: readiness=${readinessRelease} pack=${packRelease}`)
    }
  }
  if (manifestRelease && packRelease && manifestRelease !== packRelease) {
    issues.push(`release mismatch: manifest=${manifestRelease} pack=${packRelease}`)
  }
  if (manifestRelease && readinessRelease && manifestRelease !== readinessRelease) {
    issues.push(`release mismatch: manifest=${manifestRelease} readiness=${readinessRelease}`)
  }
  if (drillChecksRelease && packRelease && drillChecksRelease !== packRelease) {
    issues.push(`release mismatch: drill-checks=${drillChecksRelease} pack=${packRelease}`)
  }
  if (drillChecksRelease && readinessRelease && drillChecksRelease !== readinessRelease) {
    issues.push(`release mismatch: drill-checks=${drillChecksRelease} readiness=${readinessRelease}`)
  }
  if (drillChecksRelease && manifestRelease && drillChecksRelease !== manifestRelease) {
    issues.push(`release mismatch: drill-checks=${drillChecksRelease} manifest=${manifestRelease}`)
  }

  const validateText = safeReadText(validationPath, 'release-drill-manifest.validation.txt', issues)
  if (validateText) {
    if (!validateText.toLowerCase().includes('valid release drill manifest')) {
      issues.push('release-drill-manifest.validation.txt does not confirm valid release drill manifest')
    }
  }

  const aoGateValidationText = safeReadText(aoGateValidationPath, 'ao-dependency-gate.validation.txt', issues)
  if (aoGateValidationText) {
    if (!aoGateValidationText.toLowerCase().includes('valid dependency gate')) {
      issues.push('ao-dependency-gate.validation.txt does not confirm valid dependency gate')
    }
  }

  if (drillChecks) {
    for (const entry of DRILL_CHECK_EMBEDDED_JSON_FIELDS) {
      const artifactPath = resolveArtifactPath(dir, filesByCanonicalName, entry.artifact)
      const artifactPayload = safeReadJson(artifactPath, entry.artifact, issues)
      if (!artifactPayload) continue
      if (!Object.hasOwn(drillChecks, entry.field)) {
        issues.push(`release-drill-checks.json is missing ${entry.field}`)
        continue
      }
      if (!isDeepStrictEqual(drillChecks[entry.field], artifactPayload)) {
        issues.push(`release-drill-checks.json ${entry.field} does not match ${entry.artifact}`)
      }
    }
  }

  strictChecks.performed = true
}

function checkReleaseDrillArtifacts(dir, options = {}) {
  const resolvedDir = resolve(dir)
  const strict = options.strict === true
  const missing = []
  const files = []
  const warnings = []
  const issues = []
  const strictChecks = { performed: false, aliasFallbackCount: 0 }
  const filesByCanonicalName = new Map()

  for (const requirement of REQUIRED_ARTIFACTS) {
    const artifact = resolveRequiredArtifact(resolvedDir, requirement)
    if (!artifact) {
      missing.push(requirement.file)
      continue
    }

    filesByCanonicalName.set(requirement.file, artifact)
    files.push(artifact)
    if (artifact.usedAlias) {
      strictChecks.aliasFallbackCount += 1
      warnings.push(`using legacy artifact name ${artifact.actualName} for ${artifact.name}`)
    }
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    dir: resolvedDir,
    strict,
    requiredCount: REQUIRED_FILES.length,
    presentCount: files.length,
    missing,
    warnings,
    issues,
    files,
    strictChecks,
  }

  if (strict && missing.length === 0) {
    validateStrict(summary, strictChecks, filesByCanonicalName)
  }

  summary.ok = summary.missing.length === 0 && summary.issues.length === 0
  return summary
}

function renderHuman(summary) {
  const lines = []
  lines.push('# Release Drill Artifact Check')
  lines.push('')
  lines.push(`- Directory: \`${summary.dir}\``)
  lines.push(`- Strict: ${summary.strict ? 'yes' : 'no'}`)
  lines.push(`- Required files: ${summary.requiredCount}`)
  lines.push(`- Present files: ${summary.presentCount}`)
  lines.push(`- Missing files: ${summary.missing.length}`)
  lines.push(`- Warnings: ${summary.warnings.length}`)
  lines.push(`- Issues: ${summary.issues.length}`)
  lines.push(`- Result: ${summary.ok ? 'OK' : 'ERROR'}`)
  if (summary.missing.length > 0) {
    lines.push('')
    lines.push('Missing:')
    for (const name of summary.missing) lines.push(`- ${name}`)
  }
  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('Warnings:')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
  }
  if (summary.issues.length > 0) {
    lines.push('')
    lines.push('Issues:')
    for (const issue of summary.issues) lines.push(`- ${issue}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function runCli(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: usageText(), stderr: `error: ${err.message}\n` }
    }
    return { exitCode: 64, stdout: usageText(), stderr: `error: ${err instanceof Error ? err.message : String(err)}\n` }
  }

  if (args.help) return { exitCode: 0, stdout: usageText(), stderr: '' }

  const summary = checkReleaseDrillArtifacts(args.dir, { strict: args.strict })
  return {
    exitCode: summary.ok ? 0 : 3,
    stdout: args.json ? `${JSON.stringify(summary, null, 2)}\n` : renderHuman(summary),
    stderr: '',
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

export { CliError, REQUIRED_ARTIFACTS, REQUIRED_FILES, checkReleaseDrillArtifacts, parseArgs, runCli, usageText }
