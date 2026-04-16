#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'

const DEFAULT_ROOT = 'src'
const RUNTIME_PREFIX = 'runtime/'
const APPROVED_RUNTIME_FILES = new Set(['runtime/config/loader.ts'])
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/check-config-loader-runtime-boundary.js [--root <dir>] [--json] [--strict] [--help]',
      '',
      'Options:',
      `  --root <dir>  Project source directory to scan (default: ${DEFAULT_ROOT})`,
      '  --json        Print structured JSON only',
      '  --strict      Exit 3 when forbidden usage is found',
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

function getScriptKind(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (lower.endsWith('.ts') || lower.endsWith('.cts') || lower.endsWith('.mts')) return ts.ScriptKind.TS
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

function skipParentheses(node) {
  let current = node
  while (current && ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function formatSnippet(kind) {
  return kind === 'element' ? 'process["env"]' : 'process.env'
}

function findProcessEnvFindings(text, filePath) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, getScriptKind(filePath))
  const findings = []

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const expression = skipParentheses(node.expression)
      if (ts.isIdentifier(expression) && expression.text === 'process' && node.name.text === 'env') {
        const position = node.getStart(sourceFile)
        findings.push({
          file: filePath,
          line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
          kind: 'property',
          expression: formatSnippet('property'),
        })
      }
    } else if (ts.isElementAccessExpression(node)) {
      const expression = skipParentheses(node.expression)
      const argument = skipParentheses(node.argumentExpression)
      if (
        ts.isIdentifier(expression) &&
        expression.text === 'process' &&
        argument !== undefined &&
        ts.isStringLiteralLike(argument) &&
        argument.text === 'env'
      ) {
        const position = node.getStart(sourceFile)
        findings.push({
          file: filePath,
          line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
          kind: 'element',
          expression: formatSnippet('element'),
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

function isRuntimeRelativePath(pathValue) {
  const normalized = normalizePath(pathValue)
  return normalized === 'runtime' || normalized.startsWith(RUNTIME_PREFIX)
}

async function checkConfigLoaderRuntimeBoundary(scanRoot) {
  const resolvedRoot = resolve(scanRoot)
  const rootStat = await stat(resolvedRoot).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`scan root does not exist or is not a directory: ${scanRoot}`)
  }

  const files = await walkFiles(resolvedRoot)
  const findings = []

  for (const file of files) {
    const relativePath = normalizePath(relative(resolvedRoot, file))
    if (!isRuntimeRelativePath(relativePath)) continue
    if (APPROVED_RUNTIME_FILES.has(relativePath)) continue

    const text = await readFile(file, 'utf8')
    const displayPath = normalizePath(relative(process.cwd(), file))
    findings.push(...findProcessEnvFindings(text, displayPath))
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
  lines.push('# Runtime Config Boundary')
  lines.push('')
  lines.push(`- Root: \`${report.inputRoot}\``)
  lines.push(`- Scanned files: ${report.scannedFiles}`)
  lines.push(`- Findings: ${report.findingCount}`)
  lines.push(`- Strict mode: \`${strict ? 'on' : 'off'}\``)
  lines.push('')

  if (report.findingCount === 0) {
    lines.push('No raw process.env usage found outside the approved loader file.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  lines.push('## Findings')
  for (const finding of report.findings) {
    lines.push(`- \`${finding.file}:${finding.line}\` uses \`${finding.expression}\``)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const report = await checkConfigLoaderRuntimeBoundary(args.root)

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...report, strict: args.strict }, null, 2)}\n`)
  } else {
    process.stdout.write(renderHuman(report, args.strict))
  }

  if (args.strict && report.findingCount > 0) {
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

export { checkConfigLoaderRuntimeBoundary, parseArgs, renderHuman }
