#!/usr/bin/env node

import { stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUIRED_RUNTIME_FILES = [
  'src/runtime/core/bytes.ts',
  'src/runtime/core/json.ts',
  'src/runtime/core/canonicalJson.ts',
  'src/runtime/core/hash.ts',
  'src/runtime/core/index.ts',
  'src/runtime/template/actions.ts',
  'src/runtime/template/secretGuard.ts',
  'src/runtime/template/validators.ts',
]

export const REQUIRED_TEST_FILES = [
  'tests/runtime-core-bytes.test.ts',
  'tests/runtime-core-json.test.ts',
  'tests/runtime-core-canonicalJson.test.ts',
  'tests/runtime-core-hash.test.ts',
  'tests/runtime-template-secretGuard.test.ts',
  'tests/template-api.test.ts',
  'tests/validate-template-backend-contract.test.ts',
]

const DEFAULT_ROOT = '.'
const LEGACY_CORE_IMPORT_PATHS = ['libs/legacy/blackcat-core']
const IMPORT_LIKE_LINE_RE = /\b(?:import|export|require)\b|\bimport\s*\(/i

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
    '  node scripts/check-legacy-core-extraction-evidence.js [--root <dir>] [--json] [--strict] [--help]',
    '',
    'Checks blackcat-core extraction evidence by verifying:',
    '  - required runtime files exist',
    '  - required tests exist',
    '  - no archived legacy core imports remain under `src/`',
    '',
    'Options:',
    `  --root <dir>  Repository root to scan (default: ${DEFAULT_ROOT})`,
    '  --json        Print structured JSON only',
    '  --strict      Exit 3 when evidence gaps are found',
    '  --help        Show this help',
    '',
    'Exit codes:',
    '  0   evidence is complete, or issues were reported without --strict',
    '  3   evidence gaps found in --strict mode, or a runtime error occurred',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizePath(pathValue) {
  return pathValue.replace(/\\/g, '/')
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
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
      case '--root':
        args.root = readValue()
        break
      default:
        if (arg.startsWith('--root=')) {
          const value = arg.slice('--root='.length)
          if (!isNonEmptyString(value)) {
            throw new CliError('missing value for --root', 64)
          }
          args.root = value
          break
        }
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  return args
}

async function pathExists(filePath) {
  const info = await stat(filePath).catch(() => null)
  return !!info && info.isFile()
}

async function dirExists(dirPath) {
  const info = await stat(dirPath).catch(() => null)
  return !!info && info.isDirectory()
}

async function collectMissingPaths(root, paths) {
  const missing = []
  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath)
    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath)
    }
  }
  return missing
}

function parseRgMatches(stdout) {
  const findings = []
  const seen = new Set()
  const lines = stdout.split(/\r?\n/)

  for (const rawLine of lines) {
    if (!isNonEmptyString(rawLine)) continue

    const firstColon = rawLine.indexOf(':')
    const secondColon = firstColon >= 0 ? rawLine.indexOf(':', firstColon + 1) : -1
    if (firstColon < 0 || secondColon < 0) continue

    const file = rawLine.slice(0, firstColon)
    const lineNumberText = rawLine.slice(firstColon + 1, secondColon)
    const lineNumber = Number.parseInt(lineNumberText, 10)
    const text = rawLine.slice(secondColon + 1)

    if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue
    if (!IMPORT_LIKE_LINE_RE.test(text)) continue

    const normalizedFile = normalizePath(file)
    const findingKey = `${normalizedFile}:${lineNumber}:${text}`
    if (seen.has(findingKey)) continue
    seen.add(findingKey)

    findings.push({
      file: normalizedFile,
      line: lineNumber,
      text: text.trimEnd(),
    })
  }

  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
  return findings
}

async function scanLegacyCoreImports(root) {
  const srcRoot = resolve(root, 'src')
  const srcExists = await dirExists(srcRoot)
  if (!srcExists) {
    return {
      sourceRoot: 'src',
      scanned: false,
      findingCount: 0,
      findings: [],
      issue: 'src directory does not exist',
    }
  }

  const args = ['-n']
  for (const pathPattern of LEGACY_CORE_IMPORT_PATHS) {
    args.push('-e', pathPattern)
  }
  args.push('src')

  const result = spawnSync('rg', args, {
    cwd: root,
    encoding: 'utf8',
  })

  if (result.error) {
    throw new Error(`unable to run rg: ${result.error.message}`)
  }

  if (result.status === 1) {
    return {
      sourceRoot: 'src',
      scanned: true,
      findingCount: 0,
      findings: [],
      issue: '',
    }
  }

  if (result.status !== 0) {
    throw new Error(`rg failed: ${result.stderr || result.stdout || `exit code ${result.status}`}`)
  }

  const findings = parseRgMatches(result.stdout)
  return {
    sourceRoot: 'src',
    scanned: true,
    findingCount: findings.length,
    findings,
    issue: '',
  }
}

function buildFileStatus(relativePath, exists) {
  return {
    path: relativePath,
    exists,
  }
}

function renderHuman(report) {
  const lines = []
  lines.push('# Legacy Core Extraction Evidence')
  lines.push('')
  lines.push(`- Root: \`${report.root}\``)
  lines.push(`- Strict mode: \`${report.strict ? 'on' : 'off'}\``)
  lines.push(`- Runtime files present: ${report.runtimeFileCount}/${report.requiredRuntimeFileCount}`)
  lines.push(`- Tests present: ${report.testCount}/${report.requiredTestCount}`)
  lines.push(`- Legacy core import findings: ${report.importFindingCount}`)
  lines.push('')

  if (report.runtimeMissing.length > 0) {
    lines.push('## Missing runtime files')
    for (const filePath of report.runtimeMissing) {
      lines.push(`- \`${filePath}\``)
    }
    lines.push('')
  }

  if (report.testMissing.length > 0) {
    lines.push('## Missing tests')
    for (const filePath of report.testMissing) {
      lines.push(`- \`${filePath}\``)
    }
    lines.push('')
  }

  if (report.importFindings.length > 0) {
    lines.push('## Legacy import findings')
    for (const finding of report.importFindings) {
      lines.push(`- \`${finding.file}:${finding.line}\` -> ${finding.text}`)
    }
    lines.push('')
  }

  if (report.importScan.issue) {
    lines.push('## Source scan issue')
    lines.push(`- ${report.importScan.issue}`)
    lines.push('')
  }

  if (
    report.runtimeMissing.length === 0 &&
    report.testMissing.length === 0 &&
    report.importFindings.length === 0 &&
    !report.importScan.issue
  ) {
    lines.push('No blackcat-core extraction evidence gaps found.')
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export async function checkLegacyCoreExtractionEvidence(root = DEFAULT_ROOT) {
  const resolvedRoot = resolve(root)
  const rootInfo = await stat(resolvedRoot).catch(() => null)
  if (!rootInfo || !rootInfo.isDirectory()) {
    throw new Error(`root does not exist or is not a directory: ${root}`)
  }

  const runtimeMissing = await collectMissingPaths(resolvedRoot, REQUIRED_RUNTIME_FILES)
  const testMissing = await collectMissingPaths(resolvedRoot, REQUIRED_TEST_FILES)
  const importScan = await scanLegacyCoreImports(resolvedRoot)
  const importFindings = importScan.findings

  const runtimeFileCount = REQUIRED_RUNTIME_FILES.length - runtimeMissing.length
  const testCount = REQUIRED_TEST_FILES.length - testMissing.length
  const ok = runtimeMissing.length === 0 && testMissing.length === 0 && importFindings.length === 0 && !importScan.issue

  return {
    ok,
    status: ok ? 'pass' : 'issues-found',
    root,
    resolvedRoot,
    strict: false,
    requiredRuntimeFileCount: REQUIRED_RUNTIME_FILES.length,
    requiredTestCount: REQUIRED_TEST_FILES.length,
    runtimeFileCount,
    testCount,
    importFindingCount: importFindings.length,
    runtimeMissing,
    testMissing,
    importScan,
    importFindings,
    runtimeFiles: REQUIRED_RUNTIME_FILES.map((filePath) => buildFileStatus(filePath, !runtimeMissing.includes(filePath))),
    tests: REQUIRED_TEST_FILES.map((filePath) => buildFileStatus(filePath, !testMissing.includes(filePath))),
  }
}

export async function runCli(argv = process.argv.slice(2)) {
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

  try {
    const report = await checkLegacyCoreExtractionEvidence(args.root)
    report.strict = args.strict

    if (args.json) {
      return {
        exitCode: args.strict && !report.ok ? 3 : 0,
        stdout: `${JSON.stringify(report, null, 2)}\n`,
        stderr: '',
      }
    }

    return {
      exitCode: args.strict && !report.ok ? 3 : 0,
      stdout: renderHuman(report),
      stderr: '',
    }
  } catch (err) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: `error: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .then(({ exitCode, stdout, stderr }) => {
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      process.exit(exitCode)
    })
    .catch((err) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(3)
    })
}
