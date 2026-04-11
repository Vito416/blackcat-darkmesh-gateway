#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

const REQUIRED_HEADINGS = [
  '## Invariant',
  '## Allowed data flow',
  '## Forbidden data flow',
  '## Boundary checks',
  '## Operational rules',
]

const REQUIRED_PHRASES = [
  'Templates are public and verifiable.',
  'Secrets live only in the per-site worker.',
  'Gateway request handlers must reject',
  'mailing',
]

function usageText() {
  return [
    'Usage:',
    '  node scripts/validate-worker-secrets-trust-model.js [--file <FILE>] [--json] [--strict] [--help]',
    '',
    'Options:',
    '  --file <FILE>   Markdown file to validate (default: ops/worker-secrets-trust-model.md)',
    '  --json          Print structured JSON only',
    '  --strict        Fail unless the document is complete',
    '  --help          Show this help',
    '',
    'Exit codes:',
    '  0   validation passed or non-strict pending state',
    '  3   malformed payload, missing required content, or strict-mode pending state',
    '  64  usage error',
  ].join('\n')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeText(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function parseArgs(argv) {
  const args = {
    file: 'ops/worker-secrets-trust-model.md',
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
      case '--file':
        args.file = readValue()
        break
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`unknown option: ${arg}`, 64)
        }
        throw new CliError(`unexpected positional argument: ${arg}`, 64)
    }
  }

  return args
}

function readMarkdown(filePath) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new CliError(`unable to read file: ${error instanceof Error ? error.message : String(error)}`, 3)
  }
  return text
}

function collectHeadings(markdown) {
  const headings = []
  const lines = markdown.split(/\r?\n/)

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (match) {
      headings.push(`## ${match[1].trim()}`)
    }
  }

  return headings
}

function findMissingHeadings(headings) {
  const headingSet = new Set(headings.map((heading) => heading.trim()))
  return REQUIRED_HEADINGS.filter((heading) => !headingSet.has(heading))
}

function findMissingPhrases(markdown) {
  const lowerMarkdown = markdown.toLowerCase()
  return REQUIRED_PHRASES.filter((phrase) => !lowerMarkdown.includes(phrase.toLowerCase()))
}

function inspectTrustModel(markdown, filePath) {
  if (!isNonEmptyString(markdown)) {
    return {
      ok: false,
      malformed: true,
      status: 'invalid',
      file: filePath,
      missingHeadings: [...REQUIRED_HEADINGS],
      missingPhrases: [...REQUIRED_PHRASES],
      warnings: ['document is empty'],
      optionalNotesPresent: false,
    }
  }

  const headings = collectHeadings(markdown)
  const missingHeadings = findMissingHeadings(headings)
  const missingPhrases = findMissingPhrases(markdown)

  const optionalNotesPresent = headings.some((heading) => {
    const normalized = heading.replace(/^##\s+/, '').trim().toLowerCase()
    return normalized === 'optional notes'
  })

  const warnings = []
  if (!optionalNotesPresent) {
    warnings.push('optional notes section missing')
  }

  const blocked = missingHeadings.length > 0 || missingPhrases.length > 0
  const pending = !blocked && !optionalNotesPresent

  const status = blocked ? 'blocked' : pending ? 'pending' : 'complete'

  return {
    ok: status === 'complete',
    malformed: false,
    status,
    file: filePath,
    missingHeadings,
    missingPhrases,
    warnings,
    optionalNotesPresent,
  }
}

function formatHuman(result) {
  const lines = [
    `File: ${result.file}`,
    `Status: \`${result.status}\``,
    `Optional notes: ${result.optionalNotesPresent ? 'present' : 'missing'}`,
    `Missing headings: ${result.missingHeadings.length > 0 ? result.missingHeadings.map((heading) => `\`${heading}\``).join(', ') : 'none'}`,
    `Missing phrases: ${result.missingPhrases.length > 0 ? result.missingPhrases.map((phrase) => `\`${phrase}\``).join(', ') : 'none'}`,
  ]

  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  return lines.join('\n')
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      return { exitCode: 0, stdout: usageText(), stderr: '' }
    }

    const filePath = resolve(process.cwd(), args.file)
    const markdown = readMarkdown(filePath)
    const result = inspectTrustModel(markdown, filePath)
    const exitCode = result.malformed || result.status === 'blocked' || (args.strict && result.status !== 'complete') ? 3 : 0

    if (args.json) {
      return {
        exitCode,
        stdout: `${JSON.stringify({ ...result, strict: args.strict, ok: exitCode === 0 }, null, 2)}\n`,
        stderr: '',
      }
    }

    return {
      exitCode,
      stdout: `${formatHuman(result)}\n`,
      stderr: '',
    }
  } catch (error) {
    if (error instanceof CliError) {
      return { exitCode: error.exitCode, stdout: `${usageText()}\n`, stderr: `${error.message}\n` }
    }

    return {
      exitCode: 3,
      stdout: '',
      stderr: `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    }
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const result = runCli()
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}

export {
  REQUIRED_HEADINGS,
  REQUIRED_PHRASES,
  formatHuman,
  inspectTrustModel,
  runCli,
  usageText,
}
