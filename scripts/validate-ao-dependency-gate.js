#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/validate-ao-dependency-gate.js --file <path>',
      '',
      'Options:',
      '  --file <PATH>   Dependency gate JSON file to validate (required)',
      '  --help          Show this help',
      '',
      'Exit codes:',
      '  0   valid dependency gate',
      '  3   invalid dependency gate',
      '  64  usage error',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateGate(gate) {
  if (!isObject(gate)) return 'dependency gate must be a JSON object'

  if (!Number.isInteger(gate.schemaVersion)) {
    return 'schemaVersion must be an integer'
  }

  if (!Array.isArray(gate.required) || gate.required.length === 0) {
    return 'required must be a non-empty array'
  }

  const requiredIds = new Set()
  for (let i = 0; i < gate.required.length; i += 1) {
    const id = gate.required[i]
    if (!isNonEmptyString(id)) return `required[${i}] must be a non-empty string`
    if (requiredIds.has(id)) return `required[${i}] must be unique`
    requiredIds.add(id)
  }

  if (!Array.isArray(gate.checks)) {
    return 'checks must be an array'
  }

  const allowedStatuses = new Set(['open', 'in_progress', 'blocked', 'closed'])
  const checkIds = new Set()
  for (let i = 0; i < gate.checks.length; i += 1) {
    const check = gate.checks[i]
    if (!isObject(check)) return `checks[${i}] must be an object`

    if (!isNonEmptyString(check.id)) return `checks[${i}].id must be a non-empty string`
    if (checkIds.has(check.id)) return `checks[${i}].id must be unique`
    checkIds.add(check.id)

    if (!allowedStatuses.has(check.status)) {
      return `checks[${i}].status must be one of open, in_progress, blocked, closed`
    }

    if (check.status === 'closed' && !isNonEmptyString(check.evidence)) {
      return `checks[${i}].evidence must be a non-empty string when status is closed`
    }
  }

  for (const requiredId of requiredIds) {
    if (!checkIds.has(requiredId)) {
      return `required id ${requiredId} must be present in checks`
    }
  }

  return null
}

async function main() {
  const argv = process.argv.slice(2)
  let filePath = ''

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    if (arg === '--file') {
      const next = argv[i + 1]
      if (typeof next === 'undefined' || next.startsWith('--')) die('missing value for --file')
      filePath = next
      i += 1
      continue
    }
    if (arg.startsWith('--file=')) {
      const next = arg.slice('--file='.length)
      if (!isNonEmptyString(next)) die('missing value for --file')
      filePath = next
      continue
    }
    if (arg.startsWith('--')) die(`unknown option: ${arg}`)
    die(`unexpected positional argument: ${arg}`)
  }

  if (!isNonEmptyString(filePath)) {
    die('--file is required')
  }

  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    die(`unable to read file: ${err instanceof Error ? err.message : String(err)}`, 64)
  }

  let gate
  try {
    gate = JSON.parse(text)
  } catch (err) {
    console.error(`invalid dependency gate: malformed JSON (${err instanceof Error ? err.message : String(err)})`)
    process.exit(3)
  }

  const error = validateGate(gate)
  if (error) {
    console.error(`invalid dependency gate: ${error}`)
    process.exit(3)
  }

  console.log(`valid dependency gate: ${filePath}`)
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(64)
})

