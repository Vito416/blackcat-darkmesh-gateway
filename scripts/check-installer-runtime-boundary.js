#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_ROOT = 'src'
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const INSTALLER_SEGMENT_RE =
  /(?:^|\/)(?:libs\/legacy\/blackcat-installer|ops\/decommission\/legacy-archive\/snapshots\/blackcat-installer)(?:\/|$)/
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const IMPORT_PATTERNS = [
  {
    kind: 'import',
    regex: /\bimport\s+(?:type\s+)?(?:[^;'"`]*?\bfrom\s*)?(['"`])([^'"`\r\n]+)\1/g,
  },
  {
    kind: 'export',
    regex: /\bexport\s+(?:type\s+)?[^;'"`]*?\bfrom\s*(['"`])([^'"`\r\n]+)\1/g,
  },
  {
    kind: 'dynamic-import',
    regex: /\bimport\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*\)/g,
  },
  {
    kind: 'require',
    regex: /\brequire(?:\.resolve)?\s*\(\s*(['"`])([^'"`\r\n]+)\1/g,
  },
]

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/check-installer-runtime-boundary.js [--root <dir>] [--json] [--strict] [--help]',
      '',
      'Options:',
      `  --root <dir>  Runtime source directory to scan (default: ${DEFAULT_ROOT})`,
      '  --json        Print structured JSON only',
      '  --strict      Exit 3 when forbidden imports are found',
      '  --help        Show this help',
      '',
      'Exit codes:',
      '  0   pass, or findings without --strict',
      '  3   findings in --strict mode, or runtime error',
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

function normalizePath(pathValue) {
  return pathValue.split(sep).join('/')
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    json: false,
    strict: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') usage(0)

    const readValue = () => {
      const next = argv[index + 1]
      if (typeof next === 'undefined' || next.startsWith('--') || !isNonEmptyString(next)) {
        die(`missing value for ${arg}`, 64)
      }
      index += 1
      return next
    }

    switch (arg) {
      case '--root':
        args.root = readValue()
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

function shouldScanFile(pathValue) {
  const lower = pathValue.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : ''
  return SOURCE_EXTENSIONS.has(ext)
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
        stack.push(absolutePath)
        continue
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isFile() && shouldScanFile(absolutePath)) {
        files.push(absolutePath)
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right))
  return files
}

function lineNumberForIndex(text, index) {
  const boundedIndex = Math.max(0, Math.min(index, text.length))
  let line = 1
  for (let cursor = 0; cursor < boundedIndex; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

function isForbiddenSpecifier(specifier) {
  const normalized = specifier.trim().replace(/\\/g, '/')
  if (!normalized || URL_SCHEME_RE.test(normalized)) return false
  return INSTALLER_SEGMENT_RE.test(normalized)
}

function findInstallerSpecifierFindings(text, filePath) {
  const findings = []
  const seen = new Set()

  for (const pattern of IMPORT_PATTERNS) {
    pattern.regex.lastIndex = 0
    let match
    while ((match = pattern.regex.exec(text)) !== null) {
      const specifier = typeof match[2] === 'string' ? match[2].trim() : ''
      if (!specifier || !isForbiddenSpecifier(specifier)) continue

      const specifierOffset = match[0].lastIndexOf(specifier)
      const specifierIndex = match.index + (specifierOffset >= 0 ? specifierOffset : 0)
      const findingKey = `${specifierIndex}:${pattern.kind}:${specifier}`
      if (seen.has(findingKey)) continue
      seen.add(findingKey)

      findings.push({
        file: filePath,
        line: lineNumberForIndex(text, specifierIndex),
        kind: pattern.kind,
        specifier,
      })
    }
  }

  return findings
}

async function checkInstallerRuntimeBoundary(scanRoot) {
  const resolvedRoot = resolve(scanRoot)
  const rootStat = await stat(resolvedRoot).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`scan root does not exist or is not a directory: ${scanRoot}`)
  }

  const files = await walkFiles(resolvedRoot)
  const findings = []

  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const displayPath = normalizePath(relative(process.cwd(), file))
    findings.push(...findInstallerSpecifierFindings(text, displayPath))
  }

  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)

  return {
    inputRoot: scanRoot,
    resolvedRoot,
    scannedFiles: files.length,
    findingCount: findings.length,
    findings,
  }
}

function renderHuman(report, strict) {
  const lines = []
  lines.push('# Installer Runtime Boundary')
  lines.push('')
  lines.push(`- Root: \`${report.inputRoot}\``)
  lines.push(`- Scanned files: ${report.scannedFiles}`)
  lines.push(`- Findings: ${report.findingCount}`)
  lines.push(`- Strict mode: \`${strict ? 'on' : 'off'}\``)
  lines.push('')

  if (report.findingCount === 0) {
    lines.push('No forbidden installer legacy imports found.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  lines.push('## Findings')
  for (const finding of report.findings) {
    lines.push(`- \`${finding.file}:${finding.line}\` imports \`${finding.specifier}\``)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const report = await checkInstallerRuntimeBoundary(args.root)

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...report, strict: args.strict }, null, 2)}\n`)
  } else {
    process.stdout.write(renderHuman(report, args.strict))
  }

  if (args.strict && report.findingCount > 0) {
    process.exit(3)
  }

  if (report.findingCount > 0) {
    return
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

export { checkInstallerRuntimeBoundary, parseArgs }
