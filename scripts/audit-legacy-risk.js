#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_DIR = 'libs/legacy'
const IGNORED_DIRS = new Set([
  '.git',
  '.github',
  'coverage',
  'dist',
  'doc',
  'docs',
  'fixtures',
  'node_modules',
  'spec',
  'test',
  'tests',
  '__tests__',
  '__fixtures__',
  'vendor',
])

const CODE_EXTENSIONS = new Set([
  '.cjs',
  '.env',
  '.import-source',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.php',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const SEVERITY_ORDER = ['critical', 'warning', 'info']
const SUPPRESSION_RE = /(?:audit:\s*allow-risk|legacy-risk:\s*ignore)/i
const PRIVATE_KEY_RE = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/
const BEARER_TOKEN_RE = /\bBearer\s+(?!YOUR\b|EXAMPLE\b|PLACEHOLDER\b|TOKEN\b|REDACTED\b)[A-Za-z0-9\-._~+/=]{20,}\b/
const SQL_KEYWORD_RE = /\b(?:select|insert|update|delete|replace|where|from|join)\b/i
const SQL_CONCAT_RE = /(?:\+|\.\s*\$|\$\{|\bconcat\s*\()/
const SECRET_ENV_RE = /\bprocess\.env\.(?:[A-Z0-9_]*?(?:SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE_KEY|API_KEY|AUTH)[A-Z0-9_]*)\b/
const CHILD_PROCESS_RE = /\b(?:child_process|node:child_process)\b/
const CHILD_PROCESS_CALL_RE = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/
const CHILD_PROCESS_SHELL_RE = /\bshell\s*:\s*true\b/
const JS_EVAL_RE = /\beval\s*\(/
const JS_NEW_FUNCTION_RE = /\bnew\s+Function\s*\(/
const PHP_DANGEROUS_RE = /\b(?:eval|exec|system|shell_exec|passthru|proc_open|popen)\s*\(/
const PHP_DYNAMIC_INCLUDE_RE = /\b(?:include|include_once|require|require_once)\s*(?:\(\s*)?\$[A-Za-z_][A-Za-z0-9_]*/

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/audit-legacy-risk.js [--dir <path>] [--json] [--strict] [--help]',
      '',
      'Options:',
      `  --dir <path>   Legacy tree to scan (default: ${DEFAULT_DIR})`,
      '  --json         Print structured JSON only',
      '  --strict       Exit 3 when critical findings exist',
      '  --help         Show this help',
      '',
      'Exit codes:',
      '  0   no critical findings, or non-strict report output',
      '  3   strict mode with critical findings, or runtime/data error',
      '  64  usage error',
      '',
      'False-positive mitigation:',
      '  - Files under docs/tests/vendor/dist/node_modules are skipped.',
      '  - Add `audit: allow-risk` or `legacy-risk: ignore` on a line to suppress it.',
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

function normalizePath(pathValue) {
  return pathValue.split(sep).join('/')
}

function parseArgs(argv) {
  const args = {
    dir: DEFAULT_DIR,
    json: false,
    strict: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        die(`missing value for ${arg}`, 64)
      }
      i += 1
      return next
    }

    switch (arg) {
      case '--dir':
        args.dir = readValue()
        break
      case '--json':
        args.json = true
        break
      case '--strict':
        args.strict = true
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`, 64)
        die(`unexpected positional argument: ${arg}`, 64)
    }
  }

  return args
}

async function readTextFile(pathValue) {
  const text = await readFile(pathValue, 'utf8')
  if (text.includes('\u0000')) return null
  return text
}

function shouldIgnoreDirectory(dirName) {
  return IGNORED_DIRS.has(dirName)
}

function shouldScanFile(pathValue) {
  const lower = pathValue.toLowerCase()
  const parts = lower.split(/[\\/]/)
  if (parts.some((part) => shouldIgnoreDirectory(part))) return false

  const fileName = parts[parts.length - 1] ?? ''
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : ''
  if (CODE_EXTENSIONS.has(ext)) return true

  if (fileName === '.env' || fileName.startsWith('.env.')) return true
  if (!ext && /(?:^|[\\/])(bin|config|scripts|src)[\\/]/.test(lower)) return true

  return false
}

async function walkFiles(rootDir) {
  const files = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (!currentDir) continue

    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name)) stack.push(absolutePath)
        continue
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isFile() && shouldScanFile(absolutePath)) files.push(absolutePath)
    }
  }

  files.sort((left, right) => left.localeCompare(right))
  return files
}

function moduleNameFromPath(scanRoot, filePath) {
  const rel = relative(scanRoot, filePath)
  const parts = normalizePath(rel).split('/')
  return parts.length > 1 && parts[0] && parts[0] !== '.' ? parts[0] : '(root)'
}

function excerptFor(line) {
  const compact = line.trim().replace(/\s+/g, ' ')
  if (compact.length <= 140) return compact
  return `${compact.slice(0, 137)}...`
}

function addFinding(bucket, moduleName, finding) {
  if (!bucket.has(moduleName)) {
    bucket.set(moduleName, {
      critical: [],
      warning: [],
      info: [],
    })
  }
  bucket.get(moduleName)[finding.severity].push(finding)
}

function createFinding({ file, line, severity, rule, message, excerpt }) {
  return { file, line, severity, rule, message, excerpt }
}

function scanLine({ line, lineNumber, filePath, hasChildProcess }) {
  if (!line || SUPPRESSION_RE.test(line)) return []

  const findings = []
  const normalized = line.trim()
  const lower = normalized.toLowerCase()
  const isJsTs = /\.(?:cjs|js|mjs|ts|tsx|jsx)$/i.test(filePath)
  const isPhp = /\.php$/i.test(filePath)

  if (PRIVATE_KEY_RE.test(line)) {
    findings.push(
      createFinding({
        file: filePath,
        line: lineNumber,
        severity: 'critical',
        rule: 'generic-private-key',
        message: 'Hardcoded private key material detected.',
        excerpt: excerptFor(line),
      }),
    )
  }

  if (BEARER_TOKEN_RE.test(line)) {
    findings.push(
      createFinding({
        file: filePath,
        line: lineNumber,
        severity: 'critical',
        rule: 'generic-bearer-token',
        message: 'Bearer token-looking secret is committed in source.',
        excerpt: excerptFor(line),
      }),
    )
  }

  if (isJsTs) {
    if (JS_EVAL_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'critical',
          rule: 'js-eval',
          message: 'Uses eval().',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (JS_NEW_FUNCTION_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'critical',
          rule: 'js-new-function',
          message: 'Uses new Function().',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (hasChildProcess && CHILD_PROCESS_SHELL_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'critical',
          rule: 'js-child-process-shell',
          message: 'child_process shell mode is enabled.',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (hasChildProcess && CHILD_PROCESS_CALL_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'warning',
          rule: 'js-child-process-call',
          message: 'child_process execution API is used.',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (SECRET_ENV_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'warning',
          rule: 'js-secret-env',
          message: 'Direct secret-like process.env access found.',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (SQL_KEYWORD_RE.test(lower) && SQL_CONCAT_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'warning',
          rule: 'generic-sql-injection-hint',
          message: 'Possible SQL injection pattern: SQL text is concatenated with values.',
          excerpt: excerptFor(line),
        }),
      )
    }
  }

  if (isPhp) {
    if (PHP_DANGEROUS_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'critical',
          rule: 'php-dangerous-function',
          message: 'Uses a high-risk PHP execution function.',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (PHP_DYNAMIC_INCLUDE_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'critical',
          rule: 'php-dynamic-include',
          message: 'Uses include/require with a variable path.',
          excerpt: excerptFor(line),
        }),
      )
    }

    if (SQL_KEYWORD_RE.test(lower) && SQL_CONCAT_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'warning',
          rule: 'generic-sql-injection-hint',
          message: 'Possible SQL injection pattern: SQL text is concatenated with values.',
          excerpt: excerptFor(line),
        }),
      )
    }
  }

  if (!isJsTs && !isPhp) {
    if (SQL_KEYWORD_RE.test(lower) && SQL_CONCAT_RE.test(line)) {
      findings.push(
        createFinding({
          file: filePath,
          line: lineNumber,
          severity: 'warning',
          rule: 'generic-sql-injection-hint',
          message: 'Possible SQL injection pattern: SQL text is concatenated with values.',
          excerpt: excerptFor(line),
        }),
      )
    }
  }

  return findings
}

async function auditLegacyRisk(scanDir) {
  const absoluteRoot = resolve(scanDir)
  const rootStat = await stat(absoluteRoot).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`scan directory does not exist or is not a directory: ${scanDir}`)
  }

  const files = await walkFiles(absoluteRoot)
  const modules = new Map()
  let criticalCount = 0
  let warningCount = 0
  let infoCount = 0

  for (const filePath of files) {
    const text = await readTextFile(filePath)
    if (text === null) continue

    const hasChildProcess = CHILD_PROCESS_RE.test(text)
    const moduleName = moduleNameFromPath(absoluteRoot, filePath)
    const lines = text.split(/\r?\n/)

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const findings = scanLine({
        line,
        lineNumber: index + 1,
        filePath,
        hasChildProcess,
      })

      for (const finding of findings) {
        addFinding(modules, moduleName, finding)
        if (finding.severity === 'critical') criticalCount += 1
        if (finding.severity === 'warning') warningCount += 1
        if (finding.severity === 'info') infoCount += 1
      }
    }
  }

  const moduleSummaries = [...modules.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([moduleName, findings]) => ({
      module: moduleName,
      findings: {
        critical: findings.critical.slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
        warning: findings.warning.slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
        info: findings.info.slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
      },
    }))

  return {
    inputDir: scanDir,
    resolvedDir: absoluteRoot,
    scannedFiles: files.length,
    totals: {
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
      findings: criticalCount + warningCount + infoCount,
    },
    modules: moduleSummaries,
  }
}

function renderHuman(report, strict) {
  const lines = []
  lines.push('# Legacy Risk Audit')
  lines.push('')
  lines.push(`- Directory: \`${report.inputDir}\``)
  lines.push(`- Scanned files: ${report.scannedFiles}`)
  lines.push(`- Modules with findings: ${report.modules.length}`)
  lines.push(`- Critical: ${report.totals.critical}`)
  lines.push(`- Warning: ${report.totals.warning}`)
  lines.push(`- Info: ${report.totals.info}`)
  lines.push(`- Strict mode: \`${strict ? 'on' : 'off'}\``)
  lines.push('')

  if (report.modules.length === 0) {
    lines.push('No risky patterns found.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  for (const moduleEntry of report.modules) {
    lines.push(`## ${moduleEntry.module}`)
    for (const severity of SEVERITY_ORDER) {
      const findings = moduleEntry.findings[severity]
      if (findings.length === 0) continue
      lines.push(`### ${severity}`)
      for (const finding of findings) {
        const relPath = normalizePath(relative(report.resolvedDir, finding.file))
        lines.push(
          `- \`${relPath}:${finding.line}\` [${finding.rule}] ${finding.message}${
            finding.excerpt ? ` — ${finding.excerpt}` : ''
          }`,
        )
      }
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const report = await auditLegacyRisk(args.dir)

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...report, strict: args.strict }, null, 2)}\n`)
  } else {
    process.stdout.write(renderHuman(report, args.strict))
  }

  if (args.strict && report.totals.critical > 0) {
    process.exit(3)
  }
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

export { auditLegacyRisk, parseArgs, renderHuman }
