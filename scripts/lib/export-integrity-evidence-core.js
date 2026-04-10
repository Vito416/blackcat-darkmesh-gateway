import { spawnSync } from 'node:child_process'
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { resolveTokensForUrls } from './compare-integrity-state-core.js'

const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const COMPARE_SCRIPT = 'scripts/compare-integrity-state.js'
const ATTEST_SCRIPT = 'scripts/generate-integrity-attestation.js'

function timestampStamp(date = new Date()) {
  const iso = date.toISOString().replace(/[:]/g, '-')
  return iso.replace(/\.\d{3}Z$/, 'Z')
}

function createBundleDir(outDir, { now = () => new Date(), pid = process.pid, random = Math.random } = {}) {
  const baseDir = resolve(outDir)
  const stamp = timestampStamp(now())
  const suffix = `${pid}-${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`
  return {
    baseDir,
    bundleDir: join(baseDir, `${stamp}-${suffix}`),
  }
}

function resolveTokenMode(args, urls, envToken = '') {
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

function defaultRunNodeScript(scriptPath, scriptArgs, extraEnv = {}, displayArgs = scriptArgs) {
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

async function writeText(path, content, writer = fsWriteFile) {
  await writer(path, content, 'utf8')
}

function buildManifest({
  startedAt,
  finishedAt,
  urls,
  args,
  bundleDir,
  compareResult,
  attestationResult,
  tokenMode,
}) {
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
      tokenCount: typeof args.tokenCount === 'number' ? args.tokenCount : Array.isArray(args.tokens) ? args.tokens.length : 0,
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

function buildCompareArgs(urls, tokens) {
  const compareArgs = ['--url', urls[0]]
  for (let i = 1; i < urls.length; i += 1) compareArgs.push('--url', urls[i])
  if (tokens.length > 0) {
    for (const token of tokens) compareArgs.push('--token', token)
  }
  return compareArgs
}

function buildAttestationArgs(urls, tokens, attestationPath, hmacEnv) {
  const attestationArgs = ['--url', urls[0]]
  for (let i = 1; i < urls.length; i += 1) attestationArgs.push('--url', urls[i])
  if (tokens.length > 0) {
    for (const token of tokens) attestationArgs.push('--token', token)
  }
  attestationArgs.push('--out', attestationPath)
  if (hmacEnv) attestationArgs.push('--hmac-env', hmacEnv)
  return attestationArgs
}

async function exportIntegrityEvidence({
  urls,
  args,
  envToken = '',
  now = () => new Date(),
  random = Math.random,
  pid = process.pid,
  runNodeScript = defaultRunNodeScript,
  writeText: writeTextFn = writeText,
  mkdir: mkdirFn = fsMkdir,
  compareScript = COMPARE_SCRIPT,
  attestationScript = ATTEST_SCRIPT,
} = {}) {
  if (!Array.isArray(urls) || urls.length < 2) throw new Error('at least two --url values are required')
  if (!args || typeof args !== 'object') throw new Error('args must be an object')

  const { tokens, tokenMode } = resolveTokenMode(args, urls, envToken)
  const { baseDir, bundleDir } = createBundleDir(args.outDir, { now, random, pid })
  await mkdirFn(bundleDir, { recursive: true })

  const startedAt = now().toISOString()
  const compareArgs = buildCompareArgs(urls, tokens)
  const compareResult = runNodeScript(compareScript, compareArgs, {}, redactTokenArgs(compareArgs))

  const attestationPath = join(bundleDir, 'attestation.json')
  const attestationArgs = buildAttestationArgs(urls, tokens, attestationPath, args.hmacEnv)
  const attestationResult = runNodeScript(
    attestationScript,
    attestationArgs,
    envToken.trim() ? { GATEWAY_INTEGRITY_STATE_TOKEN: envToken } : {},
    redactTokenArgs(attestationArgs),
  )

  const compareLogPath = join(bundleDir, 'compare.txt')
  await writeTextFn(
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

  const finishedAt = now().toISOString()
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
  const manifestPath = join(bundleDir, 'manifest.json')
  await writeTextFn(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const exitCode =
    compareResult.status !== 0 ? compareResult.status : attestationResult.status !== 0 ? attestationResult.status || 1 : 0

  return {
    baseDir,
    bundleDir,
    compareLogPath,
    attestationPath,
    manifestPath,
    startedAt,
    finishedAt,
    tokenMode,
    urls,
    tokens,
    compareResult,
    attestationResult,
    manifest,
    exitCode,
  }
}

export {
  VALID_PROTOCOLS,
  COMPARE_SCRIPT,
  ATTEST_SCRIPT,
  timestampStamp,
  createBundleDir,
  resolveTokenMode,
  quoteArg,
  formatCommandLine,
  redactTokenArgs,
  defaultRunNodeScript,
  renderSection,
  writeText,
  buildManifest,
  buildCompareArgs,
  buildAttestationArgs,
  exportIntegrityEvidence,
}
