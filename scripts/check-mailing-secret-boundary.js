#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'

const DEFAULT_ROOT = 'src/runtime/mailing'
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/check-mailing-secret-boundary.js [--root <dir>] [--json] [--strict] [--help]',
      '',
      'Options:',
      `  --root <dir>  Mailing runtime source directory to scan (default: ${DEFAULT_ROOT})`,
      '  --json        Print structured JSON only',
      '  --strict      Exit 3 when forbidden secret access is found',
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

function lineNumberForIndex(text, index) {
  const boundedIndex = Math.max(0, Math.min(index, text.length))
  let line = 1
  for (let cursor = 0; cursor < boundedIndex; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

function findMailingSecretFindings(text, filePath) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, getScriptKind(filePath))
  const findings = []

  function record(node, kind, expression) {
    const position = node.getStart(sourceFile)
    findings.push({
      file: filePath,
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      kind,
      expression,
    })
  }

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') {
        record(node, 'property', 'process.env')
      }
      if (
        ts.isMetaProperty(node.expression) &&
        node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        node.expression.name.text === 'meta' &&
        node.name.text === 'env'
      ) {
        record(node, 'property', 'import.meta.env')
      }
    } else if (ts.isElementAccessExpression(node)) {
      const expression = node.expression
      const argument = node.argumentExpression
      if (
        ts.isIdentifier(expression) &&
        expression.text === 'process' &&
        argument !== undefined &&
        ts.isStringLiteralLike(argument) &&
        argument.text === 'env'
      ) {
        record(node, 'element', 'process["env"]')
      }
      if (
        ts.isMetaProperty(expression) &&
        expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        expression.name.text === 'meta' &&
        argument !== undefined &&
        ts.isStringLiteralLike(argument) &&
        argument.text === 'env'
      ) {
        record(node, 'element', 'import.meta["env"]')
      }
    } else if (ts.isVariableDeclaration(node)) {
      if (
        ts.isObjectBindingPattern(node.name) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.initializer) &&
        node.initializer.text === 'process'
      ) {
        for (const element of node.name.elements) {
          const propertyName = element.propertyName
          const name = element.name
          if ((propertyName && ts.isIdentifier(propertyName) && propertyName.text === 'env') || (ts.isIdentifier(name) && name.text === 'env')) {
            record(element, 'binding', 'const { env } = process')
            break
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

async function checkMailingSecretBoundary(scanRoot) {
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
    findings.push(...findMailingSecretFindings(text, displayPath))
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
  lines.push('# Mailing Secret Boundary')
  lines.push('')
  lines.push(`- Root: \`${report.inputRoot}\``)
  lines.push(`- Scanned files: ${report.scannedFiles}`)
  lines.push(`- Findings: ${report.findingCount}`)
  lines.push(`- Strict mode: \`${strict ? 'on' : 'off'}\``)
  lines.push('')

  if (report.findingCount === 0) {
    lines.push('No local secret access found in mailing runtime files.')
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

function renderJson(report, strict) {
  return `${JSON.stringify(
    {
      status: report.findingCount === 0 ? 'pass' : 'issues-found',
      strict,
      ...report,
    },
    null,
    2,
  )}\n`
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const report = await checkMailingSecretBoundary(args.root)
  const output = args.json ? renderJson(report, args.strict) : renderHuman(report, args.strict)
  process.stdout.write(output)

  if (report.findingCount > 0 && args.strict) {
    process.exit(3)
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(3)
  })
}

export { checkMailingSecretBoundary }
