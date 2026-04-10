import { Buffer } from 'buffer'
import crypto from 'crypto'
import { fetchEntry, put, sweep, forgetSubject, dropKey } from './cache.js'
import { inc, gauge, toProm } from './metrics.js'
import { check as rateCheck } from './ratelimit.js'
import { verifyStripe, verifyPayPal, noteCert } from './webhooks.js'
import { markAndCheck } from './replay.js'
import { proxyTemplateCall } from './templateApi.js'
import { fetchIntegritySnapshot } from './integrity/client.js'
import { readIntegrityCheckpoint, writeIntegrityCheckpoint } from './integrity/checkpoint.js'
import { sha256Hex, verifyManifestEntry } from './integrity/verifier.js'
import { applySecurityHeaders } from './securityHeaders.js'
import type { IntegritySnapshot } from './integrity/types.js'

type WebhookProvider = 'stripe' | 'paypal' | 'gopay'
type IntegrityPolicyState = { paused: boolean; source: 'env' | 'ao' | 'checkpoint' }
type IntegrityContext = { state: IntegrityPolicyState; snapshot: IntegritySnapshot | null }
type IntegrityIncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
type IntegrityRole = 'root' | 'upgrade' | 'emergency' | 'reporter'
type IntegrityIncidentRecord = {
  incidentId: string
  action: string
  event: string
  source: string
  severity: IntegrityIncidentSeverity
  paused: boolean
  recordedAt: string
}
type IntegrityIncidentReplayRecord = IntegrityIncidentRecord & {
  seenAt: number
}

const templateReadActions = new Set(['public.resolve-route', 'public.get-page'])
const templateWriteActions = new Set(['checkout.create-order', 'checkout.create-payment-intent'])
const incidentSeverities = new Set<IntegrityIncidentSeverity>(['low', 'medium', 'high', 'critical'])
const INTEGRITY_CACHE_DEFAULT_TTL_MS = 10_000
const INTEGRITY_INCIDENT_MAX_BODY_DEFAULT_BYTES = 16_384
const WEBHOOK_MAX_BODY_DEFAULT_BYTES = 262_144
const incidentActionRoles: Record<string, IntegrityRole[]> = {
  report: ['reporter', 'emergency', 'root'],
  ack: ['reporter', 'emergency', 'root'],
  pause: ['emergency', 'root'],
  resume: ['emergency', 'root'],
}
const integrityIncidentReplay = new Map<string, IntegrityIncidentReplayRecord>()
const INTEGRITY_INCIDENT_REPLAY_DEFAULT_TTL_MS = 30 * 60 * 1000
const INTEGRITY_INCIDENT_REPLAY_DEFAULT_CAP = 256

type IntegrityRuntimeCache = {
  expiresAt: number
  state: IntegrityPolicyState
  snapshot: IntegritySnapshot | null
}

const integrityRuntime: IntegrityRuntimeCache = {
  expiresAt: 0,
  state: { paused: false, source: 'env' },
  snapshot: null,
}

function respond(body?: BodyInit | null, init?: ResponseInit): Response {
  return applySecurityHeaders(new Response(body, init))
}

function secureResponse(response: Response): Response {
  return applySecurityHeaders(response)
}

function updateIntegrityAuditGauges(snapshot: IntegritySnapshot | null) {
  if (!snapshot) {
    gauge('gateway_integrity_audit_seq_from', 0)
    gauge('gateway_integrity_audit_seq_to', 0)
    gauge('gateway_integrity_audit_lag_seconds', 0)
    gauge('gateway_integrity_checkpoint_age_seconds', 0)
    return
  }

  gauge('gateway_integrity_audit_seq_from', snapshot.audit.seqFrom)
  gauge('gateway_integrity_audit_seq_to', snapshot.audit.seqTo)
  const acceptedAtMs = Date.parse(snapshot.audit.acceptedAt)
  if (!Number.isFinite(acceptedAtMs)) {
    gauge('gateway_integrity_audit_lag_seconds', 0)
    gauge('gateway_integrity_checkpoint_age_seconds', 0)
    return
  }
  const ageSec = Math.max(0, Math.floor((Date.now() - acceptedAtMs) / 1000))
  gauge('gateway_integrity_audit_lag_seconds', ageSec)
  gauge('gateway_integrity_checkpoint_age_seconds', ageSec)
}

function readEnvIntegrityPolicyState(): IntegrityPolicyState {
  const fallbackPaused = process.env.GATEWAY_INTEGRITY_POLICY_PAUSED === '1'
  const raw = process.env.GATEWAY_INTEGRITY_POLICY_JSON?.trim()
  if (!raw) return { paused: fallbackPaused, source: 'env' }

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.paused === 'boolean') {
      return { paused: parsed.paused, source: 'env' }
    }
  } catch (_) {
    // Ignore malformed policy JSON and fall back to the env flag.
  }

  return { paused: fallbackPaused, source: 'env' }
}

function readIntegrityCacheTtlMs(): number {
  const raw = process.env.GATEWAY_INTEGRITY_CACHE_TTL_MS
  const parsed = raw ? Number.parseInt(raw, 10) : INTEGRITY_CACHE_DEFAULT_TTL_MS
  if (!Number.isFinite(parsed) || parsed <= 0) return INTEGRITY_CACHE_DEFAULT_TTL_MS
  return parsed
}

function readIntegrityIncidentReplayTtlMs(): number {
  const raw = process.env.GATEWAY_INTEGRITY_INCIDENT_REPLAY_TTL_MS
  const parsed = raw ? Number.parseInt(raw, 10) : INTEGRITY_INCIDENT_REPLAY_DEFAULT_TTL_MS
  if (!Number.isFinite(parsed) || parsed <= 0) return INTEGRITY_INCIDENT_REPLAY_DEFAULT_TTL_MS
  return parsed
}

function readIntegrityIncidentReplayCap(): number {
  const raw = process.env.GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP
  const parsed = raw ? Number.parseInt(raw, 10) : INTEGRITY_INCIDENT_REPLAY_DEFAULT_CAP
  if (!Number.isFinite(parsed) || parsed <= 0) return INTEGRITY_INCIDENT_REPLAY_DEFAULT_CAP
  return parsed
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function readIntegrityIncidentMaxBodyBytes(): number {
  return readPositiveIntEnv('GATEWAY_INTEGRITY_INCIDENT_MAX_BODY_BYTES', INTEGRITY_INCIDENT_MAX_BODY_DEFAULT_BYTES)
}

function readWebhookMaxBodyBytes(): number {
  return readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', WEBHOOK_MAX_BODY_DEFAULT_BYTES)
}

function pruneIntegrityIncidentReplay(now = Date.now()) {
  const ttlMs = readIntegrityIncidentReplayTtlMs()
  for (const [incidentId, record] of integrityIncidentReplay.entries()) {
    if (now - record.seenAt > ttlMs) {
      integrityIncidentReplay.delete(incidentId)
    }
  }

  const cap = readIntegrityIncidentReplayCap()
  while (integrityIncidentReplay.size > cap) {
    const oldestKey = integrityIncidentReplay.keys().next().value
    if (!oldestKey) break
    integrityIncidentReplay.delete(oldestKey)
  }
}

async function resolveIntegrityPolicyState(): Promise<IntegrityPolicyState> {
  const now = Date.now()
  if (integrityRuntime.expiresAt > now) {
    gauge('gateway_integrity_policy_paused', integrityRuntime.state.paused ? 1 : 0)
    return integrityRuntime.state
  }

  const fallback = readEnvIntegrityPolicyState()
  let resolved: IntegrityPolicyState = fallback
  let snapshot: IntegritySnapshot | null = null

  try {
    snapshot = await fetchIntegritySnapshot()
    resolved = { paused: !!snapshot.policy.paused, source: 'ao' }
    await writeIntegrityCheckpoint(snapshot).catch(() => null)
  } catch (_) {
    inc('gateway_integrity_snapshot_fetch_fail')
    snapshot = await readIntegrityCheckpoint().catch(() => null)
    if (snapshot) {
      resolved = { paused: !!snapshot.policy.paused, source: 'checkpoint' }
      inc('gateway_integrity_checkpoint_restore')
    }
  }

  integrityRuntime.state = resolved
  integrityRuntime.snapshot = snapshot
  integrityRuntime.expiresAt = now + readIntegrityCacheTtlMs()
  gauge('gateway_integrity_policy_paused', resolved.paused ? 1 : 0)
  updateIntegrityAuditGauges(snapshot)
  return resolved
}

async function resolveIntegrityContext(): Promise<IntegrityContext> {
  const state = await resolveIntegrityPolicyState()
  return { state, snapshot: integrityRuntime.snapshot }
}

function requireVerifiedCache(): boolean {
  return process.env.GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE === '1'
}

function collectTrustedRoots(snapshot: IntegritySnapshot): string[] {
  const roots = new Set<string>()
  if (snapshot.policy.activeRoot) roots.add(snapshot.policy.activeRoot)
  if (snapshot.release.root) roots.add(snapshot.release.root)
  if (snapshot.policy.pendingUpgrade?.root) roots.add(snapshot.policy.pendingUpgrade.root)
  if (snapshot.policy.compatibilityState?.root) roots.add(snapshot.policy.compatibilityState.root)
  return [...roots]
}

function integrityErrorStatus(code: string): number {
  if (code === 'policy_paused') return 503
  if (code === 'missing_trusted_root') return 503
  return 422
}

function policyPausedResponse(): Response {
  inc('gateway_integrity_unverified_block')
  const payload = {
    error: 'policy_paused',
    reason: 'integrity_policy_paused',
    paused: true,
    retryable: false,
  }
  return respond(JSON.stringify(payload), {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

function incidentDuplicateResponse(record: IntegrityIncidentRecord): Response {
  inc('gateway_integrity_incident_duplicate')
  return respond(
    JSON.stringify({
      ok: true,
      duplicate: true,
      idempotent: true,
      incidentId: record.incidentId,
      action: record.action,
      paused: record.paused,
      status: 'duplicate',
      recordedAt: record.recordedAt,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  )
}

function markReadonlyFallback(paused: boolean) {
  if (paused) inc('gateway_integrity_fallback_readonly')
}

function requestIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') || 'unknown'
}

function rateLimitResponse(key: string): Response | null {
  if (rateCheck(key)) return null
  return respond('Too Many Requests', { status: 429 })
}

function readBearerToken(request: Request): string {
  const auth = request.headers.get('authorization') || ''
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  return ''
}

function readHeaderToken(request: Request, headerName: string): string {
  return (request.headers.get(headerName) || '').trim()
}

function tokenEquals(expected: string, presented: string): boolean {
  if (!expected || !presented) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function checkToken(request: Request, expectedToken: string, headerName: string): boolean {
  const bearer = readBearerToken(request)
  const header = readHeaderToken(request, headerName)
  return tokenEquals(expectedToken, bearer) || tokenEquals(expectedToken, header)
}

function basicCredentialsMatch(expectedUser: string, expectedPass: string, presented: string): boolean {
  if (!presented || !/^Basic\s+/i.test(presented)) return false
  try {
    const b64 = presented.replace(/^Basic\s+/i, '')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    const colonIndex = decoded.indexOf(':')
    if (colonIndex <= 0) return false
    const user = decoded.slice(0, colonIndex)
    const pass = decoded.slice(colonIndex + 1)
    return tokenEquals(expectedUser, user) && tokenEquals(expectedPass, pass)
  } catch (_) {
    return false
  }
}

function jsonErrorResponse(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return respond(JSON.stringify({ error, ...extra }), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

function plainErrorResponse(status: number, message: string): Response {
  return respond(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function bodyExceedsLimit(body: string, limitBytes: number): boolean {
  return Buffer.byteLength(body, 'utf8') > limitBytes
}

function incidentBodyTooLargeResponse(): Response {
  inc('gateway_integrity_incident_reject_size')
  return jsonErrorResponse(413, 'payload_too_large', { retryable: false })
}

function webhookBodyTooLargeResponse(): Response {
  inc('gateway_webhook_reject_size')
  return plainErrorResponse(413, 'payload too large')
}

function splitRefsCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function readIncidentSignatureRef(req: Request, body: unknown): string {
  const customHeaderName = (process.env.GATEWAY_INTEGRITY_INCIDENT_REF_HEADER || 'x-signature-ref').trim()
  const headerRef = customHeaderName ? readHeaderToken(req, customHeaderName) : ''
  if (headerRef) return headerRef
  if (body && typeof body === 'object' && typeof (body as any).signatureRef === 'string') {
    return (body as any).signatureRef.trim()
  }
  return ''
}

function readRoleRefsFromEnv(role: IntegrityRole): string[] {
  const envByRole: Record<IntegrityRole, string> = {
    root: process.env.GATEWAY_INTEGRITY_ROLE_ROOT_REFS || '',
    upgrade: process.env.GATEWAY_INTEGRITY_ROLE_UPGRADE_REFS || '',
    emergency: process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS || '',
    reporter: process.env.GATEWAY_INTEGRITY_ROLE_REPORTER_REFS || '',
  }
  return splitRefsCsv(envByRole[role])
}

function collectRoleRefs(role: IntegrityRole, integrity: IntegrityContext): string[] {
  const refs = new Set<string>()
  const authority = integrity.snapshot?.authority
  const roleRef = authority?.[role]
  if (typeof roleRef === 'string' && roleRef.trim()) {
    refs.add(roleRef.trim())
  }
  for (const ref of readRoleRefsFromEnv(role)) {
    refs.add(ref)
  }
  return [...refs]
}

function collectAllowedIncidentRefs(action: string, integrity: IntegrityContext): { roles: IntegrityRole[]; refs: string[] } {
  const roles = incidentActionRoles[action] || []
  const refs = new Set<string>()
  for (const role of roles) {
    for (const ref of collectRoleRefs(role, integrity)) refs.add(ref)
  }
  return { roles, refs: [...refs] }
}

function recordWebhook5xx(provider: WebhookProvider) {
  inc(`gateway_webhook_${provider}_5xx`)
}

async function wrapWebhook(provider: WebhookProvider, fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    const res = await fn()
    if (res.status >= 500) recordWebhook5xx(provider)
    return secureResponse(res)
  } catch (_) {
    recordWebhook5xx(provider)
    return respond('error', { status: 500 })
  }
}

async function handleInbox(req: Request): Promise<Response> {
  const ip = requestIp(req)
  if (!rateCheck(`inbox:${ip}`)) {
    return respond('Too Many Requests', { status: 429 })
  }
  inc('gateway_inbox_accept')
  // skeleton: just ack
  return respond('ok', { status: 200 })
}

async function handleCache(
  req: Request,
  key: string,
  paused: boolean,
  integritySnapshot: IntegritySnapshot | null,
): Promise<Response> {
  const verifiedCacheRequired = requireVerifiedCache()
  if (req.method === 'PUT') {
    if (paused) return policyPausedResponse()
    const buf = await req.arrayBuffer()
    const subject = req.headers.get('X-Subject') || undefined

    if (verifiedCacheRequired) {
      if (!integritySnapshot?.policy?.activeRoot) {
        inc('gateway_integrity_verify_fail')
        return respond(JSON.stringify({ error: 'missing_trusted_root' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }

      const root = (req.headers.get('x-integrity-root') || '').trim()
      const declaredHash = (req.headers.get('x-integrity-hash') || '').trim()
      const actualHash = sha256Hex(new Uint8Array(buf))
      if (declaredHash && declaredHash !== actualHash) {
        inc('gateway_integrity_verify_fail')
        return respond(JSON.stringify({ error: 'integrity_mismatch' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        })
      }

      const verify = verifyManifestEntry(
        { root, hash: actualHash },
        {
          activeRoot: integritySnapshot.policy.activeRoot,
          trustedRoots: collectTrustedRoots(integritySnapshot),
          expectedHash: declaredHash || undefined,
          paused: integritySnapshot.policy.paused,
        },
      )

      if (!verify.ok) {
        inc('gateway_integrity_verify_fail')
        return respond(JSON.stringify({ error: verify.code || 'integrity_mismatch' }), {
          status: integrityErrorStatus(verify.code || 'integrity_mismatch'),
          headers: { 'content-type': 'application/json' },
        })
      }

      inc('gateway_integrity_verify_ok')
      const stored = put(key, buf, {
        subject,
        integrity: {
          verified: true,
          root,
          hash: actualHash,
          verifiedAt: Date.now(),
        },
      })
      if (!stored) {
        return respond(JSON.stringify({ error: 'cache_budget_exceeded' }), {
          status: 507,
          headers: { 'content-type': 'application/json' },
        })
      }
    } else {
      const stored = put(key, buf, subject)
      if (!stored) {
        return respond(JSON.stringify({ error: 'cache_budget_exceeded' }), {
          status: 507,
          headers: { 'content-type': 'application/json' },
        })
      }
    }
    return respond('stored', { status: 201 })
  }
  if (req.method === 'GET') {
    markReadonlyFallback(paused)
    const result = fetchEntry(key, { requireVerified: verifiedCacheRequired })
    if (result.status === 'unverified') {
      return respond(JSON.stringify({ error: 'integrity_mismatch' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (result.status !== 'hit') return respond('miss', { status: 404 })
    return respond(result.value, { status: 200 })
  }
  return respond('method', { status: 405 })
}

async function handleTemplateCall(req: Request, paused: boolean): Promise<Response> {
  inc('gateway_template_call')
  if (req.method !== 'POST') return respond('method', { status: 405 })

  const limited = rateLimitResponse(`template:${requestIp(req)}`)
  if (limited) return limited

  const requiredToken = process.env.GATEWAY_TEMPLATE_TOKEN
  if (requiredToken) {
    const presented = (req.headers.get('x-template-token') || '').trim()
    if (!tokenEquals(requiredToken, presented)) {
      inc('gateway_template_call_blocked')
      return respond(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    inc('gateway_template_call_blocked')
    return respond(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const action = String((body as any).action || '').trim()
  const payload = (body as any).payload
  if (!action) {
    inc('gateway_template_call_blocked')
    return respond(JSON.stringify({ error: 'action_required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (paused && templateWriteActions.has(action)) {
    return policyPausedResponse()
  }

  if (paused && templateReadActions.has(action)) {
    markReadonlyFallback(true)
  }

  const res = await proxyTemplateCall({
    action,
    payload,
    requestId: typeof (body as any).requestId === 'string' ? (body as any).requestId : undefined,
    siteId: typeof (body as any).siteId === 'string' ? (body as any).siteId : undefined,
    actor: typeof (body as any).actor === 'string' ? (body as any).actor : undefined,
  })

  if (res.status >= 200 && res.status < 300) {
    inc('gateway_template_call_ok')
  } else if (res.status >= 500) {
    inc('gateway_template_call_backend_fail')
  } else {
    inc('gateway_template_call_blocked')
  }

  return secureResponse(res)
}

async function handleIntegrityState(req: Request, integrity: IntegrityContext): Promise<Response> {
  if (req.method !== 'GET') return respond('method', { status: 405 })

  const token = process.env.GATEWAY_INTEGRITY_STATE_TOKEN || ''
  if (token && !checkToken(req, token, 'x-integrity-token')) {
    inc('gateway_integrity_state_auth_blocked')
    return respond(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  inc('gateway_integrity_state_read')
  const payload = {
    policy: {
      paused: integrity.state.paused,
      source: integrity.state.source,
      activeRoot: integrity.snapshot?.policy?.activeRoot || null,
      activePolicyHash: integrity.snapshot?.policy?.activePolicyHash || null,
      maxCheckInAgeSec: integrity.snapshot?.policy?.maxCheckInAgeSec || null,
    },
    release: integrity.snapshot?.release || null,
    authority: integrity.snapshot?.authority || null,
    audit: integrity.snapshot?.audit || null,
  }
  return respond(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function handleIntegrityIncident(req: Request, integrity: IntegrityContext): Promise<Response> {
  if (req.method !== 'POST') return respond('method', { status: 405 })

  const bodyText = await req.text()
  if (bodyExceedsLimit(bodyText, readIntegrityIncidentMaxBodyBytes())) {
    return incidentBodyTooLargeResponse()
  }

  const token = process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN || ''
  if (!token) {
    return respond('incident_auth_not_configured', { status: 500 })
  }
  if (!checkToken(req, token, 'x-incident-token')) {
    inc('gateway_integrity_incident_auth_blocked')
    return jsonErrorResponse(401, 'unauthorized')
  }

  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return jsonErrorResponse(400, 'invalid_json')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonErrorResponse(400, 'invalid_json')
  }

  const event = String((body as any).event || '').trim()
  const source = String((body as any).source || 'gateway').trim()
  const severityInput = String((body as any).severity || 'medium').toLowerCase() as IntegrityIncidentSeverity
  const action = String((body as any).action || 'report').toLowerCase()
  const providedIncidentId =
    typeof (body as any).incidentId === 'string' && (body as any).incidentId.trim().length > 0
      ? (body as any).incidentId.trim()
      : null

  if (!event || event.length > 128) {
    return jsonErrorResponse(400, 'event_required')
  }
  if (!source || source.length > 128) {
    return jsonErrorResponse(400, 'invalid_source')
  }
  if (!incidentSeverities.has(severityInput)) {
    return jsonErrorResponse(400, 'invalid_severity')
  }
  if (!['report', 'ack', 'pause', 'resume'].includes(action)) {
    return jsonErrorResponse(400, 'invalid_action')
  }
  if (process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF === '1') {
    const { roles, refs } = collectAllowedIncidentRefs(action, integrity)
    if (roles.length === 0 || refs.length === 0) {
      return jsonErrorResponse(500, 'incident_ref_policy_not_configured')
    }
    const presentedRef = readIncidentSignatureRef(req, body)
    if (!presentedRef || !refs.includes(presentedRef)) {
      inc('gateway_integrity_incident_role_blocked')
      return jsonErrorResponse(403, 'forbidden_signature_ref')
    }
  }
  if (providedIncidentId && providedIncidentId.length > 128) {
    return jsonErrorResponse(400, 'invalid_incident_id')
  }

  const incidentId =
    providedIncidentId && providedIncidentId.length > 0 ? providedIncidentId : crypto.randomUUID()
  pruneIntegrityIncidentReplay()
  const existingIncident = providedIncidentId ? integrityIncidentReplay.get(incidentId) || null : null
  if (existingIncident) {
    return incidentDuplicateResponse(existingIncident)
  }

  if (action === 'pause') {
    integrityRuntime.state = { paused: true, source: 'env' }
    integrityRuntime.expiresAt = Date.now() + readIntegrityCacheTtlMs()
    gauge('gateway_integrity_policy_paused', 1)
  } else if (action === 'resume') {
    integrityRuntime.state = { paused: false, source: 'env' }
    integrityRuntime.expiresAt = Date.now() + readIntegrityCacheTtlMs()
    gauge('gateway_integrity_policy_paused', 0)
  }

  const details = (body as any).details ?? null
  const occurredAt =
    typeof (body as any).occurredAt === 'string' && (body as any).occurredAt.trim()
      ? (body as any).occurredAt.trim()
      : new Date().toISOString()

  const incident = {
    incidentId,
    event,
    source,
    severity: severityInput,
    action,
    occurredAt,
    receivedAt: new Date().toISOString(),
    details,
  }

  inc('gateway_integrity_incident')
  if (providedIncidentId) {
    integrityIncidentReplay.set(incidentId, {
      incidentId,
      action,
      event,
      source,
      severity: severityInput,
      paused: integrityRuntime.state.paused,
      recordedAt: incident.receivedAt,
      seenAt: Date.now(),
    })
    pruneIntegrityIncidentReplay()
  }

  const notifyUrl = (process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_URL || '').trim()
  if (notifyUrl) {
    const notifyToken = (process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_TOKEN || '').trim()
    const notifyHmac = (process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_HMAC || '').trim()
    const bodyRaw = JSON.stringify(incident)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (notifyToken) headers.authorization = `Bearer ${notifyToken}`
    if (notifyHmac) {
      headers['x-signature'] = crypto.createHmac('sha256', notifyHmac).update(bodyRaw).digest('hex')
    }

    try {
      const res = await fetch(notifyUrl, { method: 'POST', headers, body: bodyRaw })
      if (!res.ok) {
        inc('gateway_integrity_incident_notify_fail')
        return respond(JSON.stringify({ error: 'incident_notify_failed', status: res.status }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        })
      }
      inc('gateway_integrity_incident_notify_ok')
    } catch (_) {
      inc('gateway_integrity_incident_notify_fail')
      return respond(JSON.stringify({ error: 'incident_notify_failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  return respond(JSON.stringify({ ok: true, incidentId, paused: integrityRuntime.state.paused, action }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const integrity = await resolveIntegrityContext()
  const integrityPaused = integrity.state.paused

  if (url.pathname === '/integrity/state') {
    markReadonlyFallback(integrityPaused)
    return handleIntegrityState(request, integrity)
  }
  if (url.pathname === '/integrity/incident') {
    return handleIntegrityIncident(request, integrity)
  }

  if (url.pathname.startsWith('/cache/forget')) {
    if (request.method !== 'POST') return respond('method', { status: 405 })
    if (integrityPaused) return policyPausedResponse()
    const token = process.env.GATEWAY_FORGET_TOKEN
    if (token) {
      const auth = request.headers.get('authorization') || request.headers.get('x-forget-token') || ''
      const bearer = auth.replace(/^Bearer\s+/i, '').trim()
      if (!tokenEquals(token, bearer) && !tokenEquals(token, auth.trim())) {
        return respond('unauthorized', { status: 401 })
      }
    }
    const body = await request.json().catch(() => ({}))
    const subject = body.subject as string | undefined
    const key = body.key as string | undefined
    let removed = 0
    if (subject) removed = forgetSubject(subject)
    if (key) removed = dropKey(key) ? 1 : removed
    return respond(JSON.stringify({ removed }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (url.pathname.startsWith('/cache/')) {
    const key = url.pathname.replace('/cache/', '')
    return handleCache(request, key, integrityPaused, integrity.snapshot)
  }
  if (url.pathname === '/inbox') {
    if (integrityPaused) return policyPausedResponse()
    return handleInbox(request)
  }
  if (url.pathname === '/template/call') {
    return handleTemplateCall(request, integrityPaused)
  }
  if (url.pathname === '/metrics') {
    markReadonlyFallback(integrityPaused)
    const needBasic = !!(process.env.METRICS_BASIC_USER && process.env.METRICS_BASIC_PASS)
    const needBearer = !!process.env.METRICS_BEARER_TOKEN
    const mustGuard = process.env.GATEWAY_REQUIRE_METRICS_AUTH !== '0'
    if (!needBasic && !needBearer && mustGuard) {
      return respond('metrics_auth_not_configured', { status: 500 })
    }
    if (needBasic || needBearer || mustGuard) {
      const auth = request.headers.get('authorization') || ''
      const alt = request.headers.get('x-metrics-token') || ''
      let authed = false
      if (needBearer && /^Bearer\s+/i.test(auth)) {
        authed = tokenEquals(process.env.METRICS_BEARER_TOKEN || '', auth.replace(/^Bearer\s+/i, '').trim())
      }
      if (needBearer && !authed && alt) {
        authed = tokenEquals(process.env.METRICS_BEARER_TOKEN || '', alt)
      }
      if (!authed && needBasic) {
        authed = basicCredentialsMatch(process.env.METRICS_BASIC_USER || '', process.env.METRICS_BASIC_PASS || '', auth)
      }
      if (!authed) {
        inc('gateway_metrics_auth_blocked')
        return respond('unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm=\"metrics\"' } })
      }
    }
    const prom = toProm()
    return respond(prom, { status: 200, headers: { 'content-type': 'text/plain; version=0.0.4' } })
  }
  if (url.pathname === '/webhook/stripe') {
    if (integrityPaused) return policyPausedResponse()
    const limited = rateLimitResponse(`webhook:stripe:${requestIp(request)}`)
    if (limited) return limited
    return wrapWebhook('stripe', async () => {
      const body = await request.text()
      if (bodyExceedsLimit(body, readWebhookMaxBodyBytes())) {
        return webhookBodyTooLargeResponse()
      }
      const ok = verifyStripe(body, request.headers.get('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET || '', parseInt(process.env.STRIPE_WEBHOOK_TOLERANCE_MS || '300000', 10))
      if (!ok) {
        inc('gateway_webhook_stripe_verify_fail')
        const shadow = process.env.GATEWAY_WEBHOOK_SHADOW_INVALID === '1'
        return respond('sig invalid', { status: shadow ? 202 : 401 })
      }
      const id = (() => { try { return JSON.parse(body)?.id as string } catch { return undefined } })()
      if (id && markAndCheck(`stripe:${id}`)) return respond('replay', { status: 200 })
      inc('gateway_webhook_stripe_ok')
      return respond('ok', { status: 200 })
    })
  }
  if (url.pathname === '/webhook/paypal') {
    if (integrityPaused) return policyPausedResponse()
    const limited = rateLimitResponse(`webhook:paypal:${requestIp(request)}`)
    if (limited) return limited
    return wrapWebhook('paypal', async () => {
      const body = await request.text()
      if (bodyExceedsLimit(body, readWebhookMaxBodyBytes())) {
        return webhookBodyTooLargeResponse()
      }
      const headers = request.headers
      const certOk = noteCert(headers.get('PayPal-Cert-Url') || undefined, headers.get('PayPal-Cert-Sha256') || undefined)
      const ok = await verifyPayPal(body, headers, process.env.PAYPAL_WEBHOOK_SECRET || undefined)
      if (!ok || !certOk) {
        inc('gateway_webhook_paypal_verify_fail')
        const shadow = process.env.GATEWAY_WEBHOOK_SHADOW_INVALID === '1'
        return respond('sig invalid', { status: shadow ? 202 : 401 })
      }
      const replayKey = headers.get('PayPal-Transmission-Id') || headers.get('Paypal-Transmission-Id')
      if (replayKey && markAndCheck(`paypal:${replayKey}`)) return respond('replay', { status: 200 })
      inc('gateway_webhook_paypal_ok')
      return respond('ok', { status: 200 })
    })
  }

  if (url.pathname === '/webhook/demo-forward') {
    if (integrityPaused) return policyPausedResponse()
    const target = process.env.WORKER_NOTIFY_URL || 'http://localhost:8787/notify'
    const token = process.env.WORKER_AUTH_TOKEN || process.env.WORKER_NOTIFY_TOKEN || 'test-notify'
    const hmacSecret = process.env.WORKER_NOTIFY_HMAC || ''
    const body = await request.text()

    // Pick breaker key by provider (query/header/body) with per-PSP overrides, fallback to generic.
    const provider = (() => {
      const q = url.searchParams.get('provider')
      if (q) return q.toLowerCase()
      const hdr = request.headers.get('x-provider')
      if (hdr) return hdr.toLowerCase()
      try {
        const parsed = JSON.parse(body)
        if (parsed?.provider) return String(parsed.provider).toLowerCase()
      } catch {}
      return undefined
    })()

    const breakerKey = (() => {
      if (provider === 'stripe' && process.env.WORKER_NOTIFY_BREAKER_KEY_STRIPE) return process.env.WORKER_NOTIFY_BREAKER_KEY_STRIPE
      if (provider === 'paypal' && process.env.WORKER_NOTIFY_BREAKER_KEY_PAYPAL) return process.env.WORKER_NOTIFY_BREAKER_KEY_PAYPAL
      if (provider === 'gopay' && process.env.WORKER_NOTIFY_BREAKER_KEY_GOPAY) return process.env.WORKER_NOTIFY_BREAKER_KEY_GOPAY
      return process.env.WORKER_NOTIFY_BREAKER_KEY || provider || 'gateway'
    })()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-breaker-key': breakerKey,
    }
    if (hmacSecret) {
      const sig = crypto.createHmac('sha256', hmacSecret).update(body).digest('hex')
      headers['X-Signature'] = sig
    }
    const resp = await fetch(target, { method: 'POST', headers, body })
    if (resp.ok) return respond('forwarded', { status: 200 })
    return respond('notify_failed', { status: 502 })
  }
  // periodic sweep
  sweep()
  if (url.pathname === '/') markReadonlyFallback(integrityPaused)
  return respond('Gateway skeleton', { status: 200 })
}
