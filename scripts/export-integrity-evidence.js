#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { parseGatewayUrls, resolveTokensForUrls } from './lib/compare-integrity-state-core.js'

const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const COMPARE_SCRIPT = 'scripts/compare-integrity-state.js'
const ATTEST_SCRIPT = 'scripts/generate-integrity-attestation.js'

function usage(exitCode = 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/export-integrity-evidence.js --url <gateway-url> --url <gateway-url> --out-dir <path> [--token <VALUE> ...] [--hmac-env <ENV_NAME>]',
      '',
      'Options:',
      '  --url <URL>        Gateway base URL; repeat at least twice',
      '  --out-dir <PATH>   Base directory for the timestamped evidence bundle',
      '  --token <VALUE>    Optional auth token; repeat once per URL or once for all URLs',
      '  --hmac-env <NAME>  Optional env var name containing an HMAC key for attestation',
      '  --help             Show this help',
      '',
      'Auth token fallback:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN',
      '',
      'Examples:',
      '  GATEWAY_INTEGRITY_STATE_TOKEN=state-secret \\',
      '    node scripts/export-integrity-evidence.js \\',
      '      --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '      --out-dir ./artifacts/evidence',
      '',
      '  node scripts/export-integrity-evidence.js \\',
      '    --url https://gw-a.example.com --url https://gw-b.example.com \\',
      '    --token token-a --token token-b \\',
      '    --out-dir ./artifacts/evidence \\',
      '    --hmac-env GATEWAY_ATTESTATION_HMAC_KEY',
    ].join('\n'),
  )
  process.exit(exitCode)
}

function die(message, exitCode = 64) {
  console.error(`error: ${message}`)
  process.exit(exitCode)
}

function parseArgs(argv) {
  const args = {
    urls: [],
    tokens: [],
    outDir: '',
    hmacEnv: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) die(`missing value for ${arg}`)
      i += 1
      return next
    }

    switch (arg) {
      case '--url':
        args.urls.push(readValue())
        break
      case '--token':
        args.tokens.push(readValue())
        break
      case '--out-dir':
        args.outDir = readValue()
        break
      case '--hmac-env':
        args.hmacEnv = readValue()
        break
      default:
        if (arg.startsWith('--')) die(`unknown option: ${arg}`)
        die(`unexpected positional argument: ${arg}`)
    }
  }

  if (args.urls.length < 2) die('at least two --url values are required')
  if (typeof args.outDir !== 'string' || !args.outDir.trim()) die('--out-dir must not be blank')
  for (const url of args.urls) {
    validateUrl(url)
  }

  for (const token of args.tokens) {
    if (typeof token !== 'string' || !token.trim()) die('--token values must not be blank')
  }
  if (args.tokens.length > 0 && args.tokens.length !== 1 && args.tokens.length !== args.urls.length) {
    die('pass either one --token for all URLs or one --token per URL')
  }

  if (args.hmacEnv && !args.hmacEnv.trim()) die('--hmac-env must not be blank')

  return args
}

function validateUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch (_) {
    die(`invalid url: ${value}`)
  }
  if (!VALID_PROTOCOLS.has(parsed.protocol)) die(`unsupported url protocol: ${value}`)
  return parsed.toString()
}

function timestampStamp(date = new Date()) {
  const iso = date.toISOString().replace(/[:]/g, '-')
  return iso.replace(/\.\d{3}Z$/, 'Z')
}

function createBundleDir(outDir) {
  const baseDir = resolve(outDir)
  const stamp = timestampStamp()
  const suffix = `${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  return {
    baseDir,
    bundleDir: join(baseDir, `${stamp}-${suffix}`),
  }
}

function resolveTokenMode(args, urls) {
  const envToken = process.env.GATEWAY_INTEGRITY_STATE_TOKEN || ''
  const tokens = resolveTokensForUrls(urls, args.tokens, envToken)

  let tokenMode = 'env:GATEWAY_INTEGRITY_STATE_TOKEN'
  if (args.tokens.length === 1) tokenMode = 'explicit:shared'
  if (args.tokens.length === urls.length) tokenMode = 'explicit:per-url'

  return { tokens, tokenMode, envToken }
}

function quoteArg(value) {
  const text = String(value)
  if (!text.length) return "''"
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function formatCommandLine(command, args) {
  return [command, ...args].map(quoteArg).join(' ')
}

function redactTokenArgs(scriptArgs) {
  const displayArgs = []
  for (let i = 0; i < scriptArgs.length; i += 1) {
    const arg = scriptArgs[i]
    if (arg === '--token') {
      displayArgs.push(arg, '<redacted>')
      i += 1
      continue
    }
    displayArgs.push(arg)
  }
  return displayArgs
}

function runNodeScript(scriptPath, scriptArgs, extraEnv = {}, displayArgs = scriptArgs) {
  const child = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
    maxBuffer: 10 * 1024 * 1024,
  })

  return {
    command: formatCommandLine(process.execPath, [scriptPath, ...displayArgs]),
    status:
      typeof child.status === 'number' ? child.status : child.signal ? 1 : child.error ? 1 : 0,
    signal: child.signal || '',
    error: child.error ? String(child.error.message || child.error) : '',
    stdout: child.stdout || '',
    stderr: child.stderr || '',
  }
}

function renderSection(title, result) {
  const lines = []
  lines.push(`== ${title} ==`)
  lines.push(`command: ${result.command}`)
  lines.push(`status: ${result.status}`)
  if (result.signal) lines.push(`signal: ${result.signal}`)
  if (result.error) lines.push(`error: ${result.error}`)
  lines.push('')
  lines.push('--- stdout ---')
  lines.push(result.stdout.trimEnd() || '(empty)')
  lines.push('')
  lines.push('--- stderr ---')
  lines.push(result.stderr.trimEnd() || '(empty)')
  lines.push('')
  return lines.join('\n')
}

async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

function buildManifest({ startedAt, finishedAt, urls, args, bundleDir, compareResult, attestationResult, tokenMode }) {
  return {
    tool: 'scripts/export-integrity-evidence.js',
    version: 1,
    startedAt,
    finishedAt,
    baseDir: dirname(bundleDir),
    bundleDir,
    urls,
    commandArgs: {
      outDir: args.outDir,
      urlCount: urls.length,
      tokenMode,
      tokenCount: args.tokens.length,
      hmacEnv: args.hmacEnv || '',
    },
    files: {
      compareLog: 'compare.txt',
      attestation: 'attestation.json',
    },
    compare: {
      command: compareResult.command,
      exitCode: compareResult.status,
      signal: compareResult.signal,
      ok: compareResult.status === 0,
    },
    attestation: {
      command: attestationResult.command,
      exitCode: attestationResult.status,
      signal: attestationResult.signal,
      ok: attestationResult.status === 0,
    },
    status: compareResult.status === 0 && attestationResult.status === 0 ? 'ok' : 'failed',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const urls = parseGatewayUrls(args.urls)
  const { tokens, tokenMode, envToken } = resolveTokenMode(args, urls)
  const { bundleDir } = createBundleDir(args.outDir)
  await mkdir(bundleDir, { recursive: true })

  const startedAt = new Date().toISOString()
  const compareArgs = ['--url', urls[0]]
  for (let i = 1; i < urls.length; i += 1) {
    compareArgs.push('--url', urls[i])
  }
  if (args.tokens.length > 0) {
    for (const token of tokens) compareArgs.push('--token', token)
  }
  const compareResult = runNodeScript(COMPARE_SCRIPT, compareArgs, {}, redactTokenArgs(compareArgs))

  const attestationPath = join(bundleDir, 'attestation.json')
  const attestationArgs = ['--url', urls[0]]
  for (let i = 1; i < urls.length; i += 1) {
    attestationArgs.push('--url', urls[i])
  }
  if (args.tokens.length > 0) {
    for (const token of tokens) attestationArgs.push('--token', token)
  }
  attestationArgs.push('--out', attestationPath)
  if (args.hmacEnv) attestationArgs.push('--hmac-env', args.hmacEnv)

  const attestationResult = runNodeScript(
    ATTEST_SCRIPT,
    attestationArgs,
    envToken.trim() ? { GATEWAY_INTEGRITY_STATE_TOKEN: envToken } : {},
    redactTokenArgs(attestationArgs),
  )

  const compareLogPath = join(bundleDir, 'compare.txt')
  await writeText(
    compareLogPath,
    [
      `# Integrity evidence export`,
      `startedAt: ${startedAt}`,
      `bundleDir: ${bundleDir}`,
      `outDir: ${resolve(args.outDir)}`,
      `urls: ${urls.join(', ')}`,
      `tokenMode: ${tokenMode}`,
      `hmacEnv: ${args.hmacEnv || '(none)'}`,
      '',
      renderSection('compare-integrity-state', compareResult),
      renderSection('generate-integrity-attestation', attestationResult),
    ].join('\n'),
  )

  const finishedAt = new Date().toISOString()
  const manifest = buildManifest({
    startedAt,
    finishedAt,
    urls,
    args: {
      outDir: args.outDir,
      tokenCount: args.tokens.length,
      hmacEnv: args.hmacEnv,
    },
    bundleDir,
    compareResult,
    attestationResult,
    tokenMode,
  })

  await writeText(join(bundleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  if (compareResult.status !== 0 || attestationResult.status !== 0) {
    console.error(`[export-integrity-evidence] bundle completed with failures in ${bundleDir}`)
    if (compareResult.status !== 0) {
      console.error(`[export-integrity-evidence] compare failed with exit code ${compareResult.status}`)
    }
    if (attestationResult.status !== 0) {
      console.error(`[export-integrity-evidence] attestation failed with exit code ${attestationResult.status}`)
    }
    process.exit(compareResult.status !== 0 ? compareResult.status : attestationResult.status || 1)
  }

  console.log(`[export-integrity-evidence] wrote evidence bundle to ${bundleDir}`)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  die(message)
})
