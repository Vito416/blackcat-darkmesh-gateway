#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const API_BASE = 'https://api.github.com'
const DEFAULT_WORKFLOW = 'ci.yml'
const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const VALID_CONSISTENCY_MODES = new Set(['pairwise', 'all'])
const VALID_PROFILES = new Set(['wedos_small', 'wedos_medium', 'diskless'])

function usageText() {
  return [
    'Usage:',
    '  node scripts/dispatch-consistency-smoke.js --owner <org> --repo <name> [--workflow <file>] [--ref <branch>] [--consistency-urls <csv>] [--consistency-token <value>] [--consistency-mode pairwise|all] [--consistency-profile wedos_small|wedos_medium|diskless] [--evidence-urls <csv>] [--evidence-token <value>] [--dry-run]',
    '',
    'Options:',
    '  --owner <ORG>               GitHub owner/org (required)',
    '  --repo <REPO>               GitHub repository name (required)',
    '  --workflow <FILE>           Workflow file or id (default: ci.yml)',
    '  --ref <REF>                 Git ref to dispatch (default: current branch or main)',
    '  --consistency-urls <CSV>    Comma-separated integrity consistency URLs',
    '  --consistency-token <VALUE> Consistency token passed to the workflow',
    '  --consistency-mode <MODE>   Consistency comparison mode (pairwise|all)',
    '  --consistency-profile <P>   Profile for drift summary (wedos_small|wedos_medium|diskless)',
    '  --evidence-urls <CSV>       Comma-separated evidence URLs',
    '  --evidence-token <VALUE>    Evidence token passed to the workflow',
    '  --dry-run                   Print the payload and skip the API call',
    '  --help                      Show this help',
    '',
    'Auth token fallback:',
    '  GH_TOKEN',
    '  GITHUB_TOKEN',
  ].join('\n')
}

class CliError extends Error {
  constructor(message, exitCode = 64) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

class CliHelp extends Error {
  constructor(message) {
    super(message)
    this.name = 'CliHelp'
    this.exitCode = 0
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateOwnerRepo(value, flagName) {
  if (!isNonEmptyString(value)) throw new CliError(`${flagName} must not be blank`)
  return value.trim()
}

function validateWorkflow(value) {
  if (!isNonEmptyString(value)) throw new CliError('--workflow must not be blank')
  return value.trim()
}

function parseCsvList(raw, flagName) {
  if (!isNonEmptyString(raw)) throw new CliError(`${flagName} must not be blank`)
  const items = raw
    .split(',')
    .map((entry) => entry.trim())
  if (items.some((entry) => entry.length === 0)) {
    throw new CliError(`${flagName} must not contain blank entries`)
  }

  for (const item of items) {
    let parsed
    try {
      parsed = new URL(item)
    } catch (_) {
      throw new CliError(`invalid url in ${flagName}: ${item}`)
    }
    if (!VALID_PROTOCOLS.has(parsed.protocol)) {
      throw new CliError(`unsupported url protocol in ${flagName}: ${item}`)
    }
  }

  return items
}

function parseOptionalToken(raw, flagName) {
  if (typeof raw === 'undefined') return undefined
  if (!isNonEmptyString(raw)) throw new CliError(`${flagName} must not be blank`)
  return raw
}

function parseConsistencyMode(raw) {
  if (typeof raw === 'undefined') return undefined
  if (!isNonEmptyString(raw)) throw new CliError('--consistency-mode must not be blank')
  const mode = raw.trim().toLowerCase()
  if (!VALID_CONSISTENCY_MODES.has(mode)) {
    throw new CliError(`unsupported consistency mode: ${raw}`)
  }
  return mode
}

function parseConsistencyProfile(raw) {
  if (typeof raw === 'undefined') return undefined
  if (!isNonEmptyString(raw)) throw new CliError('--consistency-profile must not be blank')
  const profile = raw.trim().toLowerCase()
  if (!VALID_PROFILES.has(profile)) {
    throw new CliError(`unsupported consistency profile: ${raw}`)
  }
  return profile
}

function resolveDefaultRef({ env = process.env, execGit = defaultGitBranch } = {}) {
  const refName = env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF || ''
  if (isNonEmptyString(refName)) return refName.trim()

  const ref = env.GITHUB_REF || ''
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length)
  if (isNonEmptyString(ref)) return ref.trim()

  const gitBranch = execGit()
  if (isNonEmptyString(gitBranch)) return gitBranch.trim()

  return 'main'
}

function defaultGitBranch() {
  try {
    const result = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return typeof result === 'string' ? result.trim() : ''
  } catch (_) {
    return ''
  }
}

function parseArgs(argv, env = process.env, execGit = defaultGitBranch) {
  const args = {
    owner: '',
    repo: '',
    workflow: DEFAULT_WORKFLOW,
    ref: '',
    dryRun: false,
    consistencyUrls: undefined,
    consistencyToken: undefined,
    consistencyMode: undefined,
    consistencyProfile: undefined,
    evidenceUrls: undefined,
    evidenceToken: undefined,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') throw new CliHelp(usageText())

    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }

    const next = argv[i + 1]
    const readValue = () => {
      if (typeof next === 'undefined' || next.startsWith('--')) throw new CliError(`missing value for ${arg}`)
      i += 1
      return next
    }

    switch (arg) {
      case '--owner':
        args.owner = readValue()
        break
      case '--repo':
        args.repo = readValue()
        break
      case '--workflow':
        args.workflow = readValue()
        break
      case '--ref':
        args.ref = readValue()
        break
      case '--consistency-urls':
        args.consistencyUrls = readValue()
        break
      case '--consistency-token':
        args.consistencyToken = readValue()
        break
      case '--consistency-mode':
        args.consistencyMode = readValue()
        break
      case '--consistency-profile':
        args.consistencyProfile = readValue()
        break
      case '--evidence-urls':
        args.evidenceUrls = readValue()
        break
      case '--evidence-token':
        args.evidenceToken = readValue()
        break
      default:
        if (arg.startsWith('--')) throw new CliError(`unknown option: ${arg}`)
        throw new CliError(`unexpected positional argument: ${arg}`)
    }
  }

  args.owner = validateOwnerRepo(args.owner, '--owner')
  args.repo = validateOwnerRepo(args.repo, '--repo')
  args.workflow = validateWorkflow(args.workflow)
  args.ref = isNonEmptyString(args.ref) ? args.ref.trim() : resolveDefaultRef({ env, execGit })

  if (typeof args.consistencyUrls !== 'undefined') {
    args.consistencyUrls = parseCsvList(args.consistencyUrls, '--consistency-urls').join(',')
  }
  if (typeof args.evidenceUrls !== 'undefined') {
    args.evidenceUrls = parseCsvList(args.evidenceUrls, '--evidence-urls').join(',')
  }

  args.consistencyToken = parseOptionalToken(args.consistencyToken, '--consistency-token')
  args.consistencyMode = parseConsistencyMode(args.consistencyMode)
  args.consistencyProfile = parseConsistencyProfile(args.consistencyProfile)
  args.evidenceToken = parseOptionalToken(args.evidenceToken, '--evidence-token')

  return args
}

function resolveApiToken(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || ''
  if (!isNonEmptyString(token)) throw new CliError('missing token: set GH_TOKEN or GITHUB_TOKEN', 64)
  return token
}

function buildInputs(args) {
  const inputs = {}
  if (typeof args.consistencyUrls !== 'undefined') inputs.consistency_urls = args.consistencyUrls
  if (typeof args.consistencyToken !== 'undefined') inputs.consistency_token = args.consistencyToken
  if (typeof args.consistencyMode !== 'undefined') inputs.consistency_mode = args.consistencyMode
  if (typeof args.consistencyProfile !== 'undefined') inputs.consistency_profile = args.consistencyProfile
  if (typeof args.evidenceUrls !== 'undefined') inputs.evidence_urls = args.evidenceUrls
  if (typeof args.evidenceToken !== 'undefined') inputs.evidence_token = args.evidenceToken
  return inputs
}

function formatInputsForLog(inputs) {
  const out = {}
  for (const [key, value] of Object.entries(inputs)) {
    if (/token/i.test(key)) {
      out[key] = '<redacted>'
    } else {
      out[key] = value
    }
  }
  return out
}

function buildDispatchUrl(owner, repo, workflow) {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`
  return new URL(path, API_BASE)
}

async function dispatchWorkflow({ owner, repo, workflow, ref, inputs, token, dryRun = false, fetchImpl = fetch }) {
  const payload = { ref, inputs }
  const endpoint = buildDispatchUrl(owner, repo, workflow)

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      endpoint: endpoint.toString(),
      payload,
    }
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText || 'response'}: ${previewText(text)}`)
  }

  return {
    ok: true,
    dryRun: false,
    endpoint: endpoint.toString(),
    status: response.status,
    payload,
    responseText: text,
  }
}

function previewText(text, limit = 280) {
  if (typeof text !== 'string') return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function printDryRun(result, inputs) {
  console.log(`dry-run: would dispatch ${result.endpoint}`)
  console.log(`ref: ${result.payload.ref}`)
  if (Object.keys(inputs).length > 0) {
    console.log(`inputs: ${JSON.stringify(formatInputsForLog(inputs))}`)
  } else {
    console.log('inputs: {}')
  }
}

function printSuccess(result) {
  console.log(`dispatched workflow: ${result.endpoint}`)
  console.log(`ref: ${result.payload.ref}`)
  const inputNames = Object.keys(result.payload.inputs || {})
  console.log(`inputs: ${inputNames.length > 0 ? inputNames.join(', ') : '(none)'}`)
}

async function runCli(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, execGit = defaultGitBranch) {
  try {
    const args = parseArgs(argv, env, execGit)
    const inputs = buildInputs(args)

    if (args.dryRun) {
      const result = await dispatchWorkflow({
        owner: args.owner,
        repo: args.repo,
        workflow: args.workflow,
        ref: args.ref,
        inputs,
        token: '',
        dryRun: true,
        fetchImpl,
      })
      printDryRun(result, inputs)
      return 0
    }

    const token = resolveApiToken(env)
    const result = await dispatchWorkflow({
      owner: args.owner,
      repo: args.repo,
      workflow: args.workflow,
      ref: args.ref,
      inputs,
      token,
      dryRun: false,
      fetchImpl,
    })
    printSuccess(result)
    return 0
  } catch (err) {
    if (err instanceof CliHelp) {
      console.log(err.message)
      return 0
    }
    if (err instanceof CliError) {
      console.error(`error: ${err.message}`)
      return err.exitCode
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(`error: dispatch failed: ${message}`)
    return 3
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  runCli().then((code) => process.exit(code)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`error: ${message}`)
    process.exit(3)
  })
}

export {
  buildInputs,
  buildDispatchUrl,
  dispatchWorkflow,
  formatInputsForLog,
  parseArgs,
  parseCsvList,
  resolveApiToken,
  resolveDefaultRef,
  runCli,
}
