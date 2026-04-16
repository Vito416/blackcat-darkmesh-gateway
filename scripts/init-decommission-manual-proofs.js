#!/usr/bin/env node

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_PROOF_DEFINITIONS = [
  { key: 'recoveryDrillLink', label: 'Recovery drill proof', placeholder: 'https://example.invalid/recovery-drill-proof' },
  { key: 'aoFallbackLink', label: 'AO fallback proof', placeholder: 'https://example.invalid/ao-fallback-proof' },
  { key: 'rollbackProofLink', label: 'Rollback proof', placeholder: 'https://example.invalid/rollback-proof' },
  { key: 'approvalsLink', label: 'Approvals / sign-off', placeholder: 'https://example.invalid/approvals-signoff' },
]

const DEFAULT_JSON_OUT = 'decommission-manual-proofs.template.json'
const DEFAULT_MD_OUT = 'decommission-manual-proofs.checklist.md'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/init-decommission-manual-proofs.js --dir <DIR> [--json-out <FILE>] [--md-out <FILE>] [--force] [--help]',
    '',
    'Options:',
    '  --dir <DIR>         Target directory for scaffold files (required)',
    '  --json-out <FILE>   Output path for the JSON template (default: <dir>/decommission-manual-proofs.template.json)',
    '  --md-out <FILE>     Output path for the Markdown checklist (default: <dir>/decommission-manual-proofs.checklist.md)',
    '  --force             Overwrite existing output files',
    '  --help              Show this help',
    '',
    'Exit codes:',
    '  0   success',
    '  3   runtime or file overwrite error',
    '  64  usage error',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    dir: '',
    jsonOut: '',
    mdOut: '',
    force: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }
    if (arg === '--force') {
      args.force = true
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
      case '--dir':
        args.dir = readValue()
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      case '--md-out':
        args.mdOut = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`, 64)
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  if (!isNonEmptyString(args.dir)) throw new CliError('--dir is required', 64)
  if (args.jsonOut && !isNonEmptyString(args.jsonOut)) throw new CliError('--json-out must not be blank', 64)
  if (args.mdOut && !isNonEmptyString(args.mdOut)) throw new CliError('--md-out must not be blank', 64)

  return args
}

function buildTemplate(dir) {
  const baseDir = resolve(dir)
  return {
    createdAt: new Date().toISOString(),
    dir: baseDir,
    status: 'pending',
    manualProofs: REQUIRED_PROOF_DEFINITIONS.map((item) => ({
      key: item.key,
      label: item.label,
      link: '',
    })),
  }
}

function renderMarkdownChecklist(template) {
  const lines = []
  lines.push('# Decommission Manual Proof Checklist')
  lines.push('')
  lines.push(`- Directory: \`${template.dir}\``)
  lines.push(`- Created: \`${template.createdAt}\``)
  lines.push(`- Status: \`${template.status}\``)
  lines.push('')
  lines.push('## Required proofs')

  for (const proof of template.manualProofs) {
    const definition = REQUIRED_PROOF_DEFINITIONS.find((item) => item.key === proof.key)
    const placeholder = definition ? definition.placeholder : 'https://example.invalid/manual-proof'
    lines.push(`- [ ] ${proof.label}: [add link](${placeholder})`)
  }

  lines.push('')
  lines.push('## JSON template shape')
  lines.push('- `manualProofs[].key`')
  lines.push('- `manualProofs[].label`')
  lines.push('- `manualProofs[].link`')
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function fileExists(path) {
  try {
    const info = await stat(path)
    return info.isFile() || info.isSymbolicLink()
  } catch (_) {
    return false
  }
}

async function ensureWritableTargets(paths, force) {
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))]
  if (uniquePaths.length !== paths.length) {
    throw new CliError('json-out and md-out must point to different files', 3)
  }

  if (force) return

  const existing = []
  for (const path of uniquePaths) {
    if (await fileExists(path)) existing.push(path)
  }

  if (existing.length > 0) {
    throw new CliError(`refusing to overwrite existing file(s): ${existing.join(', ')}; use --force to replace them`, 3)
  }
}

async function writeIfAllowed(path, content, force) {
  const outputPath = resolve(path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: `${usageText()}\n`, stderr: '' }
    }

    const template = buildTemplate(args.dir)
    const jsonOut = args.jsonOut || resolve(args.dir, DEFAULT_JSON_OUT)
    const mdOut = args.mdOut || resolve(args.dir, DEFAULT_MD_OUT)
    await ensureWritableTargets([jsonOut, mdOut], args.force)
    const jsonText = `${JSON.stringify(template, null, 2)}\n`
    const mdText = renderMarkdownChecklist(template)

    await writeIfAllowed(jsonOut, jsonText, args.force)
    await writeIfAllowed(mdOut, mdText, args.force)

    return {
      exitCode: 0,
      stdout: `${JSON.stringify(
        {
          dir: template.dir,
          jsonOut: resolve(jsonOut),
          mdOut: resolve(mdOut),
          createdAt: template.createdAt,
          manualProofCount: template.manualProofs.length,
        },
        null,
        2,
      )}\n`,
      stderr: '',
    }
  } catch (err) {
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: '', stderr: `error: ${err.message}\n` }
    }
    return { exitCode: 3, stdout: '', stderr: `error: ${err instanceof Error ? err.message : String(err)}\n` }
  }
}

async function main() {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main()
}

export {
  DEFAULT_JSON_OUT,
  DEFAULT_MD_OUT,
  REQUIRED_PROOF_DEFINITIONS,
  buildTemplate,
  parseArgs,
  renderMarkdownChecklist,
  runCli,
  usageText,
  writeIfAllowed,
}
