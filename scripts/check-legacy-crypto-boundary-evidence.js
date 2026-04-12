#!/usr/bin/env node

import { stat, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUIRED_RUNTIME_FILES = [
  'src/runtime/crypto/boundary.ts',
  'src/runtime/crypto/hmac.ts',
  'src/runtime/crypto/safeCompare.ts',
  'src/runtime/crypto/signatureRefs.ts',
  'src/webhooks.ts',
]

export const REQUIRED_TEST_FILES = [
  'tests/runtime-crypto-safeCompare.test.ts',
  'tests/runtime-crypto-hmac.test.ts',
  'tests/runtime-crypto-signatureRefs.test.ts',
  'tests/runtime-crypto-boundary.test.ts',
  'tests/webhooks.test.ts',
]

export const FORBIDDEN_SIGNING_PATTERNS = [
  {
    id: 'createPrivateKey',
    description: 'private key construction in request-path runtime',
    regex: /\bcreatePrivateKey\s*\(/gi,
  },
  {
    id: 'crypto.sign',
    description: 'direct signing in request-path runtime',
    regex: /\bcrypto\.sign\s*\(/gi,
  },
  {
    id: 'nacl.sign',
    description: 'tweetnacl signing in request-path runtime',
    regex: /\bnacl\.sign\b/gi,
  },
  {
    id: 'walletJson',
    description: 'wallet file reference in request-path runtime',
    regex: /wallet\.json/gi,
  },
  {
    id: 'privateKeyPem',
    description: 'embedded private key material in request-path runtime',
    regex: /BEGIN [A-Z ]*PRIVATE KEY/gi,
  },
  {
    id: 'ed25519',
    description: 'ed25519 signing references in request-path runtime',
    regex: /\bed25519\b/gi,
  },
  {
    id: 'secp256k1',
    description: 'secp256k1 signing references in request-path runtime',
    regex: /\bsecp256k1\b/gi,
  },
  {
    id: 'seedPhrase',
    description: 'seed phrase handling in request-path runtime',
    regex: /\bseed phrase\b/gi,
  },
  {
    id: 'mnemonic',
    description: 'mnemonic handling in request-path runtime',
    regex: /\bmnemonic\b/gi,
  },
]

const DEFAULT_ROOT = '.'
const LEGACY_CRYPTO_IMPORT_PATHS = ['libs/legacy/blackcat-crypto', 'ops/decommission/legacy-archive/snapshots/blackcat-crypto']
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
    '  node scripts/check-legacy-crypto-boundary-evidence.js [--root <dir>] [--json] [--strict] [--help]',
    '',
    'Checks blackcat-crypto extraction evidence by verifying:',
    '  - required runtime files exist',
    '  - required tests exist',
    '  - no archived legacy crypto imports remain under `src/`',
    '  - runtime crypto boundary stays verification-only (no signing/wallet/private-key capabilities)',
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

async function scanLegacyCryptoImports(root) {
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
  for (const pathPattern of LEGACY_CRYPTO_IMPORT_PATHS) {
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

function lineNumberForIndex(text, index) {
  const boundedIndex = Math.max(0, Math.min(index, text.length))
  let line = 1
  for (let cursor = 0; cursor < boundedIndex; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

async function scanForbiddenSigningPatterns(root) {
  const findings = []

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    const absolutePath = resolve(root, relativePath)
    const exists = await pathExists(absolutePath)
    if (!exists) continue

    const source = await readFile(absolutePath, 'utf8')
    for (const rule of FORBIDDEN_SIGNING_PATTERNS) {
      rule.regex.lastIndex = 0
      let match
      while ((match = rule.regex.exec(source)) !== null) {
        const index = typeof match.index === 'number' ? match.index : 0
        const value = typeof match[0] === 'string' ? match[0] : ''
        findings.push({
          file: normalizePath(relativePath),
          line: lineNumberForIndex(source, index),
          pattern: rule.id,
          description: rule.description,
          value,
        })
      }
    }
  }

  findings.sort((left, right) => {
    const fileOrder = left.file.localeCompare(right.file)
    if (fileOrder !== 0) return fileOrder
    return left.line - right.line
  })
  return findings
}

function buildFileStatus(relativePath, exists) {
  return {
    path: relativePath,
    exists,
  }
}

function renderHuman(report) {
  const lines = []
  lines.push('# Legacy Crypto Boundary Evidence')
  lines.push('')
  lines.push(`- Root: \`${report.root}\``)
  lines.push(`- Strict mode: \`${report.strict ? 'on' : 'off'}\``)
  lines.push(`- Runtime files present: ${report.runtimeFileCount}/${report.requiredRuntimeFileCount}`)
  lines.push(`- Tests present: ${report.testCount}/${report.requiredTestCount}`)
  lines.push(`- Legacy crypto import findings: ${report.importFindingCount}`)
  lines.push(`- Forbidden signing findings: ${report.forbiddenSigningFindingCount}`)
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

  if (report.forbiddenSigningFindings.length > 0) {
    lines.push('## Forbidden signing findings')
    for (const finding of report.forbiddenSigningFindings) {
      lines.push(`- \`${finding.file}:${finding.line}\` [${finding.pattern}] -> ${finding.value}`)
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
    report.forbiddenSigningFindings.length === 0 &&
    !report.importScan.issue
  ) {
    lines.push('No blackcat-crypto boundary evidence gaps found.')
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export async function checkLegacyCryptoBoundaryEvidence(root = DEFAULT_ROOT) {
  const resolvedRoot = resolve(root)
  const rootInfo = await stat(resolvedRoot).catch(() => null)
  if (!rootInfo || !rootInfo.isDirectory()) {
    throw new Error(`root does not exist or is not a directory: ${root}`)
  }

  const runtimeMissing = await collectMissingPaths(resolvedRoot, REQUIRED_RUNTIME_FILES)
  const testMissing = await collectMissingPaths(resolvedRoot, REQUIRED_TEST_FILES)
  const importScan = await scanLegacyCryptoImports(resolvedRoot)
  const importFindings = importScan.findings
  const forbiddenSigningFindings = await scanForbiddenSigningPatterns(resolvedRoot)

  const runtimeFileCount = REQUIRED_RUNTIME_FILES.length - runtimeMissing.length
  const testCount = REQUIRED_TEST_FILES.length - testMissing.length
  const ok =
    runtimeMissing.length === 0 &&
    testMissing.length === 0 &&
    importFindings.length === 0 &&
    forbiddenSigningFindings.length === 0 &&
    !importScan.issue

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
    forbiddenSigningFindingCount: forbiddenSigningFindings.length,
    runtimeMissing,
    testMissing,
    importScan,
    importFindings,
    forbiddenSigningFindings,
    runtimeFiles: await Promise.all(
      REQUIRED_RUNTIME_FILES.map(async (relativePath) => buildFileStatus(relativePath, await pathExists(resolve(resolvedRoot, relativePath)))),
    ),
    tests: await Promise.all(
      REQUIRED_TEST_FILES.map(async (relativePath) => buildFileStatus(relativePath, await pathExists(resolve(resolvedRoot, relativePath)))),
    ),
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write(`${usageText()}\n`)
    return
  }

  const report = await checkLegacyCryptoBoundaryEvidence(args.root)
  report.strict = args.strict

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(renderHuman(report))
  }

  if (args.strict && !report.ok) {
    process.exit(3)
  }
}

async function main() {
  try {
    await runCli(process.argv.slice(2))
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`)
      process.stdout.write(`${usageText()}\n`)
      process.exit(err.exitCode)
      return
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(3)
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export { parseArgs, renderHuman, scanForbiddenSigningPatterns, scanLegacyCryptoImports, usageText }
