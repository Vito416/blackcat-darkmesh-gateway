import { Hono } from 'hono'
import { parseAndValidateDmTxtEnvelope } from './dnsTxtParser'
import {
  validateAndVerifyDmConfig,
  validateConfigKidAgainstTxt
} from './configValidator.js'

type QueueLike = {
  send: (message: unknown) => Promise<void> | void
}

type Env = {
  MAILER_AUTH_TOKEN?: string
  JOBS_AUTH_TOKEN?: string
  MAIL_PROVIDER?: string
  MAIL_FROM?: string
  REFRESH_DOMAINS?: string
  REFRESH_BATCH_LIMIT?: string
  DNS_RESOLVER_URL?: string
  AR_GATEWAY_URL?: string
  HB_PROBE_TIMEOUT_MS?: string
  HB_PROBE_ALLOWLIST?: string
  REFRESH_SIGNATURE_STRICT?: string
  DOMAIN_REFRESH_QUEUE?: QueueLike
}

type DomainRefreshRequest = {
  domain: string
  reason?: string
  force?: boolean
  dryRun?: boolean
  txtPayload?: string
  configJson?: Record<string, unknown>
  hbProbeUrl?: string
}

type RefreshMode = 'inline' | 'queue' | 'scheduled' | 'batch'

type JobEnvelope = {
  type: 'refresh-domain'
  payload: DomainRefreshRequest
}

type RefreshResult = {
  ok: true
  domain: string
  mode: RefreshMode
  cfgTx: string
  hbProbe: {
    status: 'ok' | 'failed' | 'skipped'
    code?: string
    statusCode?: number
    target?: string
  }
}

type FetchLike = typeof fetch

class ControlledError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

type StructuredLogLevel = 'info' | 'warn' | 'error'

const DEFAULT_DNS_RESOLVER = 'https://dns.google/resolve'
const DEFAULT_AR_GATEWAY = 'https://arweave.net'
const DEFAULT_PROBE_TIMEOUT_MS = 2500
const DEFAULT_REFRESH_BATCH_LIMIT = 10
const MAX_REFRESH_BATCH_LIMIT = 100

const HOST_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i

const app = new Hono<{ Bindings: Env }>()

function logJson(level: StructuredLogLevel, event: string, payload: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  })
  if (level === 'error') {
    console.error(line)
    return
  }
  console.log(line)
}

function logRefreshOutcome(
  level: StructuredLogLevel,
  mode: RefreshMode,
  domain: string,
  code: string,
  latencyMs: number
) {
  logJson(level, 'refresh_outcome', {
    mode,
    domain,
    code,
    latencyMs
  })
}

function getAuthToken(reqToken: string | undefined) {
  return reqToken?.replace(/^Bearer\s+/i, '').trim()
}

function verifyInternalAuth(c: { req: { header: (name: string) => string | undefined }; env: Env }) {
  const token = getAuthToken(c.req.header('authorization'))
  const expected = c.env?.JOBS_AUTH_TOKEN || c.env?.MAILER_AUTH_TOKEN
  if (!token || !expected || token !== expected) {
    throw new ControlledError(401, 'unauthorized', 'Missing or invalid internal auth token.')
  }
}

function parseJsonObject(value: unknown, code = 'invalid_payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ControlledError(400, code, 'Expected JSON object payload.')
  }
  return value as Record<string, unknown>
}

function normalizeDomain(raw: unknown) {
  if (typeof raw !== 'string') {
    throw new ControlledError(422, 'domain_invalid', 'domain must be a string.', { field: 'domain' })
  }
  const domain = raw.trim().toLowerCase()
  if (!HOST_RE.test(domain)) {
    throw new ControlledError(422, 'domain_invalid', 'domain has invalid format.', { field: 'domain' })
  }
  return domain
}

function csvList(input: string | undefined): string[] {
  if (!input) return []
  const items = input
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(items))
}

function parsePositiveInt(raw: string | undefined, fallback: number, max?: number) {
  const value = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isFinite(value) || value <= 0) return fallback
  if (typeof max === 'number') return Math.min(value, max)
  return value
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function isSignatureStrictMode(env: Env): boolean {
  const explicit = parseBoolean(env.REFRESH_SIGNATURE_STRICT)
  if (typeof explicit === 'boolean') return explicit
  // Default fail-open for safe production rollout; can be enabled per env/site.
  return false
}

function mapConfigOrSignatureCodeToStatus(code: string): number {
  if (code.startsWith('sig_')) return 403
  if (code.startsWith('config_') || code === 'domain_invalid') return 422
  return 422
}

function ensureAllowlistedHbUrl(rawUrl: string, env: Env) {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (_error) {
    throw new ControlledError(422, 'hb_probe_invalid_url', 'hbProbeUrl must be a valid absolute URL.')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ControlledError(422, 'hb_probe_invalid_url', 'hbProbeUrl must use http/https.')
  }

  const allowlist = csvList(env.HB_PROBE_ALLOWLIST)
  if (allowlist.length > 0 && !allowlist.includes(parsed.hostname.toLowerCase())) {
    throw new ControlledError(
      422,
      'hb_probe_not_allowlisted',
      'hb probe target host is not in allowlist.',
      { host: parsed.hostname }
    )
  }

  return parsed.toString()
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      throw new ControlledError(502, 'upstream_fetch_failed', 'Upstream request failed.', {
        url,
        status: res.status
      })
    }
    return parseJsonObject(body, 'upstream_invalid_json')
  } catch (error) {
    if (error instanceof ControlledError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ControlledError(504, 'upstream_timeout', 'Upstream request timed out.', { url })
    }
    throw new ControlledError(502, 'upstream_fetch_failed', 'Unable to fetch upstream resource.', {
      url,
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    clearTimeout(timeout)
  }
}

function readFirstTxtAnswer(payload: Record<string, unknown>) {
  const answer = payload.Answer
  if (!Array.isArray(answer) || answer.length === 0) {
    throw new ControlledError(404, 'txt_not_found', 'No TXT records found for _darkmesh host.')
  }

  for (const item of answer) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const data = (item as Record<string, unknown>).data
    if (typeof data !== 'string') {
      continue
    }
    const normalized = data.replace(/^"(.*)"$/, '$1').trim()
    if (normalized) {
      return normalized
    }
  }

  throw new ControlledError(422, 'txt_invalid_payload', 'TXT record payload is not usable.')
}

async function resolveTxtPayload(
  domain: string,
  env: Env,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<string> {
  const resolver = (env.DNS_RESOLVER_URL || DEFAULT_DNS_RESOLVER).replace(/\/+$/, '')
  const url = `${resolver}?name=${encodeURIComponent(`_darkmesh.${domain}`)}&type=TXT`
  const payload = await fetchJsonWithTimeout(url, timeoutMs, fetchImpl)
  return readFirstTxtAnswer(payload)
}

async function resolveConfigJson(
  cfgTx: string,
  env: Env,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const gateway = (env.AR_GATEWAY_URL || DEFAULT_AR_GATEWAY).replace(/\/+$/, '')
  const payload = await fetchJsonWithTimeout(`${gateway}/${cfgTx}`, timeoutMs, fetchImpl)
  return payload
}

function deriveProbeUrl(
  requestProbeUrl: unknown,
  config: Record<string, unknown>
): string | null {
  if (typeof requestProbeUrl === 'string' && requestProbeUrl.trim()) {
    return requestProbeUrl.trim()
  }
  const probeField = config.hbProbeUrl
  if (typeof probeField === 'string' && probeField.trim()) {
    return probeField.trim()
  }
  const hbField = config.hbUrl
  if (typeof hbField === 'string' && hbField.trim()) {
    return hbField.trim()
  }
  return null
}

async function probeHbIntegrity(
  rawUrl: string,
  env: Env,
  fetchImpl: FetchLike
): Promise<RefreshResult['hbProbe']> {
  const target = ensureAllowlistedHbUrl(rawUrl, env)
  const timeoutMs = parsePositiveInt(env.HB_PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(target, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' }
    })

    if (res.status >= 500) {
      return { status: 'failed', code: 'hb_probe_failed', statusCode: res.status, target }
    }
    return { status: 'ok', statusCode: res.status, target }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'failed', code: 'hb_probe_timeout', target }
    }
    return { status: 'failed', code: 'hb_probe_failed', target }
  } finally {
    clearTimeout(timeout)
  }
}

async function runDomainRefresh(
  input: DomainRefreshRequest,
  env: Env,
  fetchImpl: FetchLike,
  mode: RefreshResult['mode']
): Promise<RefreshResult> {
  const domain = normalizeDomain(input.domain)
  const timeoutMs = parsePositiveInt(env.HB_PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS)

  const txtPayload =
    typeof input.txtPayload === 'string' && input.txtPayload.trim()
      ? input.txtPayload.trim()
      : await resolveTxtPayload(domain, env, fetchImpl, timeoutMs)

  const envelope = parseAndValidateDmTxtEnvelope(txtPayload)
  if (!envelope.ok) {
    throw new ControlledError(422, envelope.error.code, envelope.error.message, envelope.error)
  }

  const configRaw =
    input.configJson && typeof input.configJson === 'object'
      ? input.configJson
      : await resolveConfigJson(envelope.value.cfg, env, fetchImpl, timeoutMs)

  const signatureValidation = await validateAndVerifyDmConfig(configRaw, {
    publicKey: envelope.value.kid
  })
  const strictMode = isSignatureStrictMode(env)

  if (!signatureValidation.ok) {
    if (strictMode) {
      throw new ControlledError(
        mapConfigOrSignatureCodeToStatus(signatureValidation.error.code),
        signatureValidation.error.code,
        signatureValidation.error.message,
        signatureValidation.error
      )
    }
    logJson('warn', 'refresh_signature_bypass', {
      mode,
      domain,
      code: signatureValidation.error.code,
      strictMode,
      reason: signatureValidation.error.message
    })
  }

  let configDomain: string | null = null
  let owner = ''

  if (signatureValidation.ok) {
    const kidCheck = validateConfigKidAgainstTxt(signatureValidation.value, envelope.value)
    if (!kidCheck.ok && strictMode) {
      throw new ControlledError(
        mapConfigOrSignatureCodeToStatus(kidCheck.error.code),
        kidCheck.error.code,
        kidCheck.error.message,
        kidCheck.error
      )
    }
    configDomain = signatureValidation.value.domain
    owner = signatureValidation.value.owner
  } else {
    configDomain = typeof configRaw.domain === 'string' ? configRaw.domain.trim().toLowerCase() : null
    owner = typeof configRaw.owner === 'string' ? configRaw.owner.trim() : ''
  }

  if (configDomain && configDomain !== domain) {
    throw new ControlledError(422, 'config_domain_mismatch', 'Config domain does not match request domain.', {
      expected: domain,
      actual: configDomain
    })
  }

  if (owner && owner !== envelope.value.kid) {
    throw new ControlledError(422, 'config_owner_mismatch', 'Config owner does not match TXT kid.', {
      expected: envelope.value.kid,
      actual: owner
    })
  }

  const probeUrl = deriveProbeUrl(input.hbProbeUrl, configRaw)
  const hbProbe = probeUrl
    ? await probeHbIntegrity(probeUrl, env, fetchImpl)
    : ({ status: 'skipped', code: 'hb_probe_target_missing' } as const)

  if (hbProbe.status === 'failed' && !input.dryRun) {
    throw new ControlledError(502, hbProbe.code || 'hb_probe_failed', 'HB integrity probe failed.', hbProbe)
  }

  return {
    ok: true,
    domain,
    mode,
    cfgTx: envelope.value.cfg,
    hbProbe: { ...hbProbe }
  }
}

async function enqueueJob(job: JobEnvelope, env: Env) {
  if (env.DOMAIN_REFRESH_QUEUE && typeof env.DOMAIN_REFRESH_QUEUE.send === 'function') {
    await env.DOMAIN_REFRESH_QUEUE.send(job)
    return 'queue' as const
  }
  return 'inline' as const
}

async function handleRefreshDomainPost(body: Record<string, unknown>, env: Env, fetchImpl: FetchLike) {
  const payload: DomainRefreshRequest = {
    domain: normalizeDomain(body.domain),
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    force: body.force === true,
    dryRun: body.dryRun === true,
    txtPayload: typeof body.txtPayload === 'string' ? body.txtPayload : undefined,
    configJson:
      body.configJson && typeof body.configJson === 'object' && !Array.isArray(body.configJson)
        ? (body.configJson as Record<string, unknown>)
        : undefined,
    hbProbeUrl: typeof body.hbProbeUrl === 'string' ? body.hbProbeUrl : undefined
  }
  return runDomainRefresh(payload, env, fetchImpl, 'inline')
}

function parseBatchRequests(body: Record<string, unknown>) {
  const candidates: DomainRefreshRequest[] = []
  const domainsRaw = body.domains
  const itemsRaw = body.items

  if (Array.isArray(itemsRaw)) {
    for (const item of itemsRaw) {
      const parsed = parseJsonObject(item, 'invalid_batch_item')
      candidates.push({
        domain: normalizeDomain(parsed.domain),
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        force: parsed.force === true,
        dryRun: parsed.dryRun === true,
        txtPayload: typeof parsed.txtPayload === 'string' ? parsed.txtPayload : undefined,
        configJson:
          parsed.configJson && typeof parsed.configJson === 'object' && !Array.isArray(parsed.configJson)
            ? (parsed.configJson as Record<string, unknown>)
            : undefined,
        hbProbeUrl: typeof parsed.hbProbeUrl === 'string' ? parsed.hbProbeUrl : undefined
      })
    }
  } else if (Array.isArray(domainsRaw)) {
    for (const domain of domainsRaw) {
      candidates.push({
        domain: normalizeDomain(domain),
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        force: body.force === true,
        dryRun: body.dryRun === true,
        txtPayload: typeof body.txtPayload === 'string' ? body.txtPayload : undefined,
        configJson:
          body.configJson && typeof body.configJson === 'object' && !Array.isArray(body.configJson)
            ? (body.configJson as Record<string, unknown>)
            : undefined,
        hbProbeUrl: typeof body.hbProbeUrl === 'string' ? body.hbProbeUrl : undefined
      })
    }
  } else {
    throw new ControlledError(400, 'invalid_batch_payload', 'Batch payload requires domains[] or items[].')
  }

  if (candidates.length === 0) {
    throw new ControlledError(400, 'invalid_batch_payload', 'Batch payload cannot be empty.')
  }

  const seen = new Set<string>()
  const deduped: DomainRefreshRequest[] = []
  const duplicates: string[] = []

  for (const candidate of candidates) {
    const key = candidate.domain
    if (seen.has(key)) {
      duplicates.push(key)
      continue
    }
    seen.add(key)
    deduped.push(candidate)
  }

  return { requests: deduped, duplicates }
}

async function runRefreshBatch(
  requests: DomainRefreshRequest[],
  env: Env,
  fetchImpl: FetchLike,
  mode: RefreshMode
) {
  const outcomes: Array<RefreshResult | { ok: false; domain: string; code: string; message: string }> = []
  const limit = parsePositiveInt(env.REFRESH_BATCH_LIMIT, DEFAULT_REFRESH_BATCH_LIMIT, MAX_REFRESH_BATCH_LIMIT)
  const selected = requests.slice(0, limit)

  let ok = 0
  let failed = 0

  for (const request of selected) {
    const started = Date.now()
    try {
      const result = await runDomainRefresh(request, env, fetchImpl, mode)
      ok += 1
      logRefreshOutcome('info', mode, request.domain, 'ok', Date.now() - started)
      outcomes.push(result)
    } catch (error) {
      const code = error instanceof ControlledError ? error.code : 'unexpected_error'
      const message = error instanceof Error ? error.message : String(error)
      failed += 1
      logRefreshOutcome('warn', mode, request.domain, code, Date.now() - started)
      outcomes.push({ ok: false, domain: request.domain, code, message })
    }
  }

  return {
    attempted: selected.length,
    ok,
    failed,
    outcomes
  }
}

async function runScheduledRefreshBatch(
  env: Env,
  fetchImpl: FetchLike
): Promise<{ attempted: number; ok: number; failed: number }> {
  const requests = csvList(env.REFRESH_DOMAINS).map((domain) => ({ domain, reason: 'scheduled' }))
  const summary = await runRefreshBatch(requests, env, fetchImpl, 'scheduled')
  return { attempted: summary.attempted, ok: summary.ok, failed: summary.failed }
}

app.onError((error, c) => {
  if (error instanceof ControlledError) {
    return c.json(
      { ok: false, error: error.code, message: error.message, details: error.details },
      error.status as any
    )
  }
  return c.json({ ok: false, error: 'internal_error' }, 500)
})

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'site-mailer-worker',
    provider: c.env?.MAIL_PROVIDER || 'unset'
  })
)

app.post('/mail/send', async (c) => {
  verifyInternalAuth(c)

  const body = await c.req.json().catch(() => null)
  parseJsonObject(body)

  // Scaffold: wire provider integration here (SMTP/API) in next batch.
  return c.json({ ok: true, accepted: true, provider: c.env?.MAIL_PROVIDER || 'unset' }, 202)
})

app.post('/jobs/enqueue', async (c) => {
  verifyInternalAuth(c)

  const started = Date.now()
  let domain = 'unknown'
  try {
    const body = parseJsonObject(await c.req.json().catch(() => null))
    const type = body.type
    const payload = parseJsonObject(body.payload, 'invalid_job_payload')

    if (type !== 'refresh-domain') {
      throw new ControlledError(400, 'unsupported_job_type', 'Only refresh-domain jobs are currently supported.')
    }

    domain = normalizeDomain(payload.domain)
    const job: JobEnvelope = {
      type: 'refresh-domain',
      payload: {
        domain,
        reason: typeof payload.reason === 'string' ? payload.reason : 'manual_enqueue',
        force: payload.force === true,
        dryRun: payload.dryRun === true
      }
    }

    const mode = await enqueueJob(job, c.env)
    if (mode === 'inline') {
      const result = await runDomainRefresh(job.payload, c.env, fetch, 'inline')
      logRefreshOutcome('info', 'inline', domain, 'ok', Date.now() - started)
      return c.json({ ok: true, accepted: true, mode, result }, 202)
    }

    logRefreshOutcome('info', 'queue', domain, 'enqueued', Date.now() - started)
    return c.json({ ok: true, accepted: true, mode, job }, 202)
  } catch (error) {
    const code = error instanceof ControlledError ? error.code : 'unexpected_error'
    logRefreshOutcome('warn', 'queue', domain, code, Date.now() - started)
    throw error
  }
})

app.post('/jobs/refresh-domain', async (c) => {
  verifyInternalAuth(c)
  const started = Date.now()
  const body = parseJsonObject(await c.req.json().catch(() => null))
  try {
    const result = await handleRefreshDomainPost(body, c.env, fetch)
    logRefreshOutcome('info', 'inline', result.domain, 'ok', Date.now() - started)
    return c.json(result, 200)
  } catch (error) {
    const code = error instanceof ControlledError ? error.code : 'unexpected_error'
    const domain =
      typeof body.domain === 'string' && body.domain.trim() ? body.domain.trim().toLowerCase() : 'unknown'
    logRefreshOutcome('warn', 'inline', domain, code, Date.now() - started)
    throw error
  }
})

app.post('/jobs/refresh-domain/batch', async (c) => {
  verifyInternalAuth(c)
  const started = Date.now()
  const body = parseJsonObject(await c.req.json().catch(() => null))
  const parsed = parseBatchRequests(body)
  const summary = await runRefreshBatch(parsed.requests, c.env, fetch, 'batch')

  logJson('info', 'refresh_batch_complete', {
    mode: 'batch',
    attempted: summary.attempted,
    ok: summary.ok,
    failed: summary.failed,
    duplicates: parsed.duplicates.length,
    latencyMs: Date.now() - started
  })

  return c.json(
    {
      ok: true,
      mode: 'batch',
      attempted: summary.attempted,
      okCount: summary.ok,
      failedCount: summary.failed,
      duplicates: parsed.duplicates,
      outcomes: summary.outcomes
    },
    200
  )
})

type ScheduledControllerLike = {
  cron: string
  scheduledTime: number
}

type ScheduledContextLike = {
  waitUntil: (promise: Promise<unknown>) => void
}

async function scheduledHandler(
  controller: ScheduledControllerLike,
  env: Env,
  ctx: ScheduledContextLike
) {
  const started = Date.now()
  const run = runScheduledRefreshBatch(env, fetch).then((summary) => {
    logJson('info', 'scheduled_refresh_complete', {
      mode: 'scheduled',
      code: summary.failed > 0 ? 'partial_failure' : 'ok',
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
      latencyMs: Date.now() - started,
      ...summary
    })
  })
  ctx.waitUntil(run)
}

const worker = {
  fetch: app.fetch.bind(app),
  scheduled: scheduledHandler,
  request: app.request.bind(app)
}

export { app, scheduledHandler, runScheduledRefreshBatch }
export default worker
