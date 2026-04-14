#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildMarkdown, buildSummary, parseMatrixJson } from './build-drift-alert-summary.js'

const VALID_PROFILES = new Set(['vps_small', 'vps_medium', 'diskless'])

class CliError extends Error {
  constructor(message, exitCode = 3) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/export-consistency-report.js --matrix <FILE> --out-dir <DIR> [--profile vps_small|vps_medium|diskless] [--prefix <NAME>]',
    '',
    'Options:',
    '  --matrix <FILE>     Matrix JSON file to read (required)',
    '  --profile <NAME>    Deployment profile (default: vps_medium)',
    '  --out-dir <DIR>     Directory for report outputs (required)',
    '  --prefix <NAME>     Output filename prefix (default: consistency)',
    '  --help              Show this help',
    '',
    'Outputs:',
    '  <prefix>-drift-report.md',
    '  <prefix>-drift-summary.json',
    '',
    'Exit codes:',
    '  0   success',
    '  3   data/runtime error',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseArgs(argv) {
  const args = {
    help: false,
    matrix: '',
    profile: 'vps_medium',
    outDir: '',
    prefix: 'consistency',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
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
      case '--matrix':
        args.matrix = readValue()
        break
      case '--profile':
        args.profile = readValue().trim().toLowerCase()
        break
      case '--out-dir':
        args.outDir = readValue()
        break
      case '--prefix':
        args.prefix = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.matrix)) throw new CliError('--matrix is required', 64)
  if (!VALID_PROFILES.has(args.profile)) throw new CliError(`unsupported profile: ${args.profile}`, 64)
  if (!isNonEmptyString(args.outDir)) throw new CliError('--out-dir is required', 64)
  if (!isNonEmptyString(args.prefix)) throw new CliError('--prefix must not be blank', 64)

  return args
}

async function readJsonFile(path) {
  const filePath = resolve(path)
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new Error(`unable to read matrix file: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`invalid matrix JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function writeTextFile(path, content) {
  const filePath = resolve(path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return filePath
}

function buildOutputPaths(outDir, prefix) {
  const baseDir = resolve(outDir)
  return {
    baseDir,
    reportPath: join(baseDir, `${prefix}-drift-report.md`),
    summaryPath: join(baseDir, `${prefix}-drift-summary.json`),
  }
}

async function exportConsistencyReport({
  matrix,
  profile = 'vps_medium',
  outDir,
  prefix = 'consistency',
  readJsonFileFn = readJsonFile,
  writeTextFileFn = writeTextFile,
} = {}) {
  if (!isNonEmptyString(matrix)) throw new CliError('--matrix is required', 64)
  if (!isNonEmptyString(outDir)) throw new CliError('--out-dir is required', 64)
  if (!VALID_PROFILES.has(profile)) throw new CliError(`unsupported profile: ${profile}`, 64)
  if (!isNonEmptyString(prefix)) throw new CliError('--prefix must not be blank', 64)

  const matrixPayload = await readJsonFileFn(matrix)
  const parsedMatrix = parseMatrixJson(matrixPayload)
  const summary = buildSummary(parsedMatrix, profile)
  const markdown = buildMarkdown(summary)
  const paths = buildOutputPaths(outDir, prefix)

  await writeTextFileFn(paths.reportPath, markdown)
  await writeTextFileFn(paths.summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

  return {
    ...paths,
    markdown,
    summary,
  }
}

async function runCli(argv = process.argv.slice(2), deps = {}) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, usage: usageText() }
    }

    const result = await exportConsistencyReport({
      ...args,
      readJsonFileFn: deps.readJsonFileFn,
      writeTextFileFn: deps.writeTextFileFn,
    })

    return {
      exitCode: 0,
      ...result,
    }
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, error: err.message }
    }
    return {
      exitCode: 3,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function main() {
  const result = await runCli(process.argv.slice(2))
  if (result.exitCode === 0) {
    if (result.usage) {
      console.log(result.usage)
    } else {
      console.log(`[export-consistency-report] wrote drift report to ${result.reportPath}`)
      console.log(`[export-consistency-report] wrote drift summary to ${result.summaryPath}`)
    }
  } else {
    console.error(`error: ${result.error}`)
  }
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export { CliError, buildOutputPaths, exportConsistencyReport, parseArgs, runCli, usageText }
