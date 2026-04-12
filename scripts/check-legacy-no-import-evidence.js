#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseManifestModules } from './validate-legacy-manifest.js'

const DEFAULT_ROOT = 'src'
const DEFAULT_MANIFEST = 'kernel-migration/legacy-archive/MANIFEST.md'
const LEGACY_IMPORT_ROOTS = ['libs/legacy', 'kernel-migration/legacy-archive/snapshots']
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
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
      '  node scripts/check-legacy-no-import-evidence.js [--root <dir>] [--manifest <path>] [--modules <csv>] [--json] [--strict] [--help]',
      '',
      'Options:',
      `  --root <dir>      Source tree to scan (default: ${DEFAULT_ROOT})`,
      `  --manifest <path> Legacy manifest markdown file (default: ${DEFAULT_MANIFEST})`,
      '  --modules <csv>   Comma- or whitespace-separated module list; overrides --manifest',
      '  --json            Print structured JSON only',
      '  --strict          Exit 3 when legacy references are found',
      '  --help            Show this help',
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

function parseModulesList(value) {
  if (!isNonEmptyString(value)) {
    return []
  }

  const modules = []
  const seen = new Set()
  for (const token of value.split(/[\s,]+/)) {
    const moduleName = token.trim().replace(/^`+/, '').replace(/`+$/, '')
    if (!moduleName || seen.has(moduleName)) continue
    seen.add(moduleName)
    modules.push(moduleName)
  }
  return modules
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    manifest: DEFAULT_MANIFEST,
    modules: [],
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
      case '--manifest':
        args.manifest = readValue()
        break
      case '--modules':
        args.modules = parseModulesList(readValue())
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function moduleLegacyPaths(moduleName) {
  return LEGACY_IMPORT_ROOTS.map((root) => `${root}/${moduleName}`)
}

function matchedLegacyPathForSpecifier(specifier, moduleName) {
  const normalized = specifier.trim().replace(/\\/g, '/')
  if (!normalized || URL_SCHEME_RE.test(normalized)) return ''

  for (const legacyPath of moduleLegacyPaths(moduleName)) {
    const escapedPath = escapeRegExp(legacyPath)
    if (new RegExp(`(?:^|/)${escapedPath}(?:/|$|\\.)`).test(normalized)) {
      return legacyPath
    }
  }

  return ''
}

function specifierReferencesModule(specifier, moduleName) {
  return matchedLegacyPathForSpecifier(specifier, moduleName) !== ''
}

function findLegacyModuleReferences(text, filePath, moduleNames) {
  const findings = []
  const seen = new Set()

  for (const pattern of IMPORT_PATTERNS) {
    pattern.regex.lastIndex = 0
    let match
    while ((match = pattern.regex.exec(text)) !== null) {
      const specifier = typeof match[2] === 'string' ? match[2].trim() : ''
      if (!specifier) continue

      const moduleName = moduleNames.find((candidate) => specifierReferencesModule(specifier, candidate))
      if (!moduleName) continue
      const legacyPathMatch = matchedLegacyPathForSpecifier(specifier, moduleName)

      const specifierOffset = match[0].lastIndexOf(specifier)
      const specifierIndex = match.index + (specifierOffset >= 0 ? specifierOffset : 0)
      const findingKey = `${moduleName}:${specifierIndex}:${pattern.kind}:${specifier}`
      if (seen.has(findingKey)) continue
      seen.add(findingKey)

      findings.push({
        module: moduleName,
        legacyPath: legacyPathMatch || moduleLegacyPaths(moduleName)[0],
        file: filePath,
        line: lineNumberForIndex(text, specifierIndex),
        kind: pattern.kind,
        specifier,
      })
    }
  }

  return findings
}

async function loadModuleNames(args) {
  if (args.modules.length > 0) {
    return {
      source: 'provided',
      manifestPath: null,
      modules: args.modules,
    }
  }

  const manifestPath = resolve(args.manifest)
  let manifestText
  try {
    manifestText = await readFile(manifestPath, 'utf8')
  } catch (err) {
    throw new Error(`unable to read manifest: ${err instanceof Error ? err.message : String(err)}`)
  }

  const modules = parseManifestModules(manifestText).map((entry) => entry.moduleName)
  return {
    source: 'manifest',
    manifestPath: args.manifest,
    modules,
  }
}

async function checkLegacyNoImportEvidence(scanRoot, args = {}) {
  const resolvedRoot = resolve(scanRoot)
  const rootStat = await stat(resolvedRoot).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`scan root does not exist or is not a directory: ${scanRoot}`)
  }

  const moduleSource = await loadModuleNames({
    manifest: args.manifest ?? DEFAULT_MANIFEST,
    modules: Array.isArray(args.modules) ? args.modules : [],
  })

  if (moduleSource.modules.length === 0) {
    throw new Error('no legacy modules were found in the manifest or provided list')
  }

  const files = await walkFiles(resolvedRoot)
  const findings = []

  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const displayPath = normalizePath(relative(process.cwd(), file))
    findings.push(...findLegacyModuleReferences(text, displayPath, moduleSource.modules))
  }

  findings.sort((left, right) =>
    left.module.localeCompare(right.module) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind) ||
    left.specifier.localeCompare(right.specifier),
  )

  const findingsByModule = new Map()
  for (const finding of findings) {
    if (!findingsByModule.has(finding.module)) {
      findingsByModule.set(finding.module, [])
    }
    findingsByModule.get(finding.module).push(finding)
  }

  const modules = moduleSource.modules.map((moduleName) => {
    const references = findingsByModule.get(moduleName) ?? []
    return {
      module: moduleName,
      legacyPath: moduleLegacyPaths(moduleName)[0],
      referenced: references.length > 0,
      findingCount: references.length,
      references,
    }
  })

  return {
    status: findings.length === 0 ? 'pass' : 'issues-found',
    moduleSource: moduleSource.source,
    inputRoot: scanRoot,
    resolvedRoot,
    manifestPath: moduleSource.manifestPath,
    moduleCount: moduleSource.modules.length,
    scannedFiles: files.length,
    referencedModuleCount: modules.filter((module) => module.referenced).length,
    findingCount: findings.length,
    modules,
    findings,
  }
}

function renderHuman(report, strict) {
  const lines = []
  lines.push('# Legacy No-Import Evidence')
  lines.push('')
  lines.push(`- Root: \`${report.inputRoot}\``)
  lines.push(`- Module source: \`${report.moduleSource}${report.manifestPath ? ` (${report.manifestPath})` : ''}\``)
  lines.push(`- Modules checked: ${report.moduleCount}`)
  lines.push(`- Scanned files: ${report.scannedFiles}`)
  lines.push(`- Referenced modules: ${report.referencedModuleCount}`)
  lines.push(`- Findings: ${report.findingCount}`)
  lines.push(`- Strict mode: \`${strict ? 'on' : 'off'}\``)
  lines.push('')

  if (report.findingCount === 0) {
    lines.push('No legacy module references found under src.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  lines.push('## Findings')
  for (const finding of report.findings) {
    lines.push(`- \`${finding.module}\` via \`${finding.kind}\` in \`${finding.file}:${finding.line}\` -> \`${finding.specifier}\``)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function renderJsonSummary(report, args) {
  return JSON.stringify({ ...report, strict: args.strict }, null, 2)
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const report = await checkLegacyNoImportEvidence(args.root, args)

  return {
    exitCode: args.strict && report.findingCount > 0 ? 3 : 0,
    stdout: args.json ? `${renderJsonSummary(report, args)}\n` : renderHuman(report, args.strict),
    stderr: '',
  }
}

async function main() {
  try {
    const result = await runCli(process.argv.slice(2))
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.exitCode)
  } catch (err) {
    die(err instanceof Error ? err.message : String(err), 3)
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export {
  checkLegacyNoImportEvidence,
  findLegacyModuleReferences,
  parseArgs,
  parseModulesList,
  renderHuman,
  renderJsonSummary,
  usage,
}
