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
import { forwardForgetEvent, readForgetForwardConfig } from './runtime/sessions/forgetForward.js'
import {
  classifyGoPayWebhookIdempotency,
  getGoPayWebhookIdempotencyPolicy,
  verifyGoPayWebhook,
} from './runtime/payments/gopayWebhook.js'
import { parseJsonObject } from './runtime/core/index.js'
import {
  basicCredentialsMatch,
  checkToken,
  readBearerToken,
  readHeaderToken,
  tokenEquals,
} from './runtime/auth/httpAuth.js'
import { requireAuthorizedSignatureRef } from './runtime/auth/policy.js'
import {
  readForgetToken,
  readHandlerEnvString,
  readHandlerStrictEnabledFlag,
  readIntegrityIncidentAuthConfig,
  readIntegrityStateToken,
  readMetricsAuthConfig,
  readPositiveIntEnv,
  readTemplateToken,
  readWebhookConfig,
  readWorkerNotifyConfig,
  resolveWorkerNotifyBreakerKey,
} from './runtime/config/handlerConfig.js'
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
  const fallbackPaused = readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_POLICY_PAUSED')
  const raw = readHandlerEnvString('GATEWAY_INTEGRITY_POLICY_JSON')
  if (!raw) return { paused: fallbackPaused, source: 'env' }

  const parsed = parseJsonObject(raw)
  if (parsed.ok && typeof parsed.value.paused === 'boolean') {
    return { paused: parsed.value.paused, source: 'env' }
  }

  // Ignore malformed policy JSON and fall back to the env flag.
  return { paused: fallbackPaused, source: 'env' }
}

function readIntegrityCacheTtlMs(): number {
  return readPositiveIntEnv('GATEWAY_INTEGRITY_CACHE_TTL_MS', INTEGRITY_CACHE_DEFAULT_TTL_MS)
}

function readIntegrityIncidentReplayTtlMs(): number {
  return readPositiveIntEnv('GATEWAY_INTEGRITY_INCIDENT_REPLAY_TTL_MS', INTEGRITY_INCIDENT_REPLAY_DEFAULT_TTL_MS)
}

function readIntegrityIncidentReplayCap(): number {
  return readPositiveIntEnv('GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP', INTEGRITY_INCIDENT_REPLAY_DEFAULT_CAP)
}

function readIntegrityIncidentMaxBodyBytes(): number {
  return readPositiveIntEnv('GATEWAY_INTEGRITY_INCIDENT_MAX_BODY_BYTES', INTEGRITY_INCIDENT_MAX_BODY_DEFAULT_BYTES)
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
  return readHandlerStrictEnabledFlag('GATEWAY_INTEGRITY_REQUIRE_VERIFIED_CACHE')
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

function readIncidentSignatureRef(req: Request, body: unknown): string {
  const customHeaderName = readIntegrityIncidentAuthConfig().refHeaderName
  const headerRef = customHeaderName ? readHeaderToken(req, customHeaderName) : ''
  if (headerRef) return headerRef
  if (body && typeof body === 'object' && typeof (body as any).signatureRef === 'string') {
    return (body as any).signatureRef.trim()
  }
  return ''
}

function readRoleRefsFromEnv(role: IntegrityRole): string[] {
  return readIntegrityIncidentAuthConfig().roleRefs[role]
}

function collectRoleRefs(role: IntegrityRole, integrity: IntegrityContext): { activeRefs: string[]; overlapRefs: string[] } {
  const activeRefs = new Set<string>()
  const overlapRefs = new Set<string>()
  const authority = integrity.snapshot?.authority
  const roleRef = authority?.[role]
  if (typeof roleRef === 'string' && roleRef.trim()) {
    activeRefs.add(roleRef.trim())
  }
  for (const ref of readRoleRefsFromEnv(role)) {
    overlapRefs.add(ref)
  }
  return { activeRefs: [...activeRefs], overlapRefs: [...overlapRefs] }
}

function collectAllowedIncidentRefs(
  action: string,
  integrity: IntegrityContext,
): { roles: IntegrityRole[]; activeRefs: string[]; overlapRefs: string[] } {
  const roles = incidentActionRoles[action] || []
  const activeRefs = new Set<string>()
  const overlapRefs = new Set<string>()
  for (const role of roles) {
    const refs = collectRoleRefs(role, integrity)
    for (const ref of refs.activeRefs) activeRefs.add(ref)
    for (const ref of refs.overlapRefs) overlapRefs.add(ref)
  }
  return { roles, activeRefs: [...activeRefs], overlapRefs: [...overlapRefs] }
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

  const requiredToken = readTemplateToken()
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
    role: typeof (body as any).role === 'string' ? (body as any).role : undefined,
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

  const token = readIntegrityStateToken()
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

  const incidentAuth = readIntegrityIncidentAuthConfig()
  const token = incidentAuth.token
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
  if (incidentAuth.requireSignatureRef) {
    const { roles, activeRefs, overlapRefs } = collectAllowedIncidentRefs(action, integrity)
    if (roles.length === 0 || (activeRefs.length === 0 && overlapRefs.length === 0)) {
      return jsonErrorResponse(500, 'incident_ref_policy_not_configured')
    }
    const presentedRef = readIncidentSignatureRef(req, body)
    const refCheck = requireAuthorizedSignatureRef(presentedRef, activeRefs, overlapRefs)
    if (!refCheck.ok) {
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

  const notifyUrl = incidentAuth.notify.url
  if (notifyUrl) {
    const notifyToken = incidentAuth.notify.token || ''
    const notifyHmac = incidentAuth.notify.hmac || ''
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
    const token = readForgetToken()
    if (token) {
      const auth = request.headers.get('authorization') || ''
      const bearer = readBearerToken(request)
      const header = readHeaderToken(request, 'x-forget-token')
      if (!tokenEquals(token, bearer) && !tokenEquals(token, auth.trim()) && !tokenEquals(token, header)) {
        return respond('unauthorized', { status: 401 })
      }
    }
    const body = await request.json().catch(() => ({}))
    const subject = body.subject as string | undefined
    const key = body.key as string | undefined
    let removed = 0
    if (subject) removed = forgetSubject(subject)
    if (key) removed = dropKey(key) ? 1 : removed
    const forwardConfig = readForgetForwardConfig()
    const forwardResult = await forwardForgetEvent(
      {
        ...(subject ? { subject } : {}),
        ...(key ? { key } : {}),
        removed,
        ts: new Date().toISOString(),
      },
      forwardConfig,
    )
    return respond(
      JSON.stringify({
        removed,
        forwarded: forwardResult.forwarded,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
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
    const metricsAuth = readMetricsAuthConfig()
    if (!metricsAuth.needBasic && !metricsAuth.needBearer && metricsAuth.mustGuard) {
      return respond('metrics_auth_not_configured', { status: 500 })
    }
    if (metricsAuth.needBasic || metricsAuth.needBearer || metricsAuth.mustGuard) {
      const auth = request.headers.get('authorization') || ''
      const bearer = readBearerToken(request)
      const alt = readHeaderToken(request, 'x-metrics-token')
      let authed = false
      if (metricsAuth.needBearer && auth) {
        authed = tokenEquals(metricsAuth.bearerToken, bearer)
      }
      if (metricsAuth.needBearer && !authed && alt) {
        authed = tokenEquals(metricsAuth.bearerToken, alt)
      }
      if (!authed && metricsAuth.needBasic) {
        authed = basicCredentialsMatch(metricsAuth.basicUser, metricsAuth.basicPass, auth)
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
      const webhookConfig = readWebhookConfig(WEBHOOK_MAX_BODY_DEFAULT_BYTES)
      const body = await request.text()
      if (bodyExceedsLimit(body, webhookConfig.maxBodyBytes)) {
        return webhookBodyTooLargeResponse()
      }
      const ok = verifyStripe(body, request.headers.get('Stripe-Signature'), webhookConfig.stripeSecret, webhookConfig.stripeToleranceMs)
      if (!ok) {
        inc('gateway_webhook_stripe_verify_fail')
        return respond('sig invalid', { status: webhookConfig.shadowInvalid ? 202 : 401 })
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
      const webhookConfig = readWebhookConfig(WEBHOOK_MAX_BODY_DEFAULT_BYTES)
      const body = await request.text()
      if (bodyExceedsLimit(body, webhookConfig.maxBodyBytes)) {
        return webhookBodyTooLargeResponse()
      }
      const headers = request.headers
      const certOk = noteCert(headers.get('PayPal-Cert-Url') || undefined, headers.get('PayPal-Cert-Sha256') || undefined)
      const ok = await verifyPayPal(body, headers, webhookConfig.paypalWebhookSecret)
      if (!ok || !certOk) {
        inc('gateway_webhook_paypal_verify_fail')
        return respond('sig invalid', { status: webhookConfig.shadowInvalid ? 202 : 401 })
      }
      const replayKey = headers.get('PayPal-Transmission-Id') || headers.get('Paypal-Transmission-Id')
      if (replayKey && markAndCheck(`paypal:${replayKey}`)) return respond('replay', { status: 200 })
      inc('gateway_webhook_paypal_ok')
      return respond('ok', { status: 200 })
    })
  }
  if (url.pathname === '/webhook/gopay') {
    if (integrityPaused) return policyPausedResponse()
    const limited = rateLimitResponse(`webhook:gopay:${requestIp(request)}`)
    if (limited) return limited
    return wrapWebhook('gopay', async () => {
      const webhookConfig = readWebhookConfig(WEBHOOK_MAX_BODY_DEFAULT_BYTES)
      const body = await request.text()
      if (bodyExceedsLimit(body, webhookConfig.maxBodyBytes)) {
        return webhookBodyTooLargeResponse()
      }
      const signatureHeader = request.headers.get('x-gopay-signature') || request.headers.get('gopay-signature')
      const ok = verifyGoPayWebhook(body, signatureHeader, webhookConfig.gopayWebhookSecret)
      if (!ok) {
        inc('gateway_webhook_gopay_verify_fail')
        return respond('sig invalid', { status: webhookConfig.shadowInvalid ? 202 : 401 })
      }
      const replayMode = getGoPayWebhookIdempotencyPolicy()
      const idempotency = classifyGoPayWebhookIdempotency(request.headers.get('x-gopay-event-id'), body, replayMode)
      if (idempotency.status === 'missing-id' || idempotency.status === 'conflict') {
        return respond(idempotency.body, { status: idempotency.httpStatus })
      }
      if (idempotency.status === 'duplicate') {
        inc('gateway_webhook_replay')
        return respond(idempotency.body, { status: idempotency.httpStatus })
      }
      inc('gateway_webhook_gopay_ok')
      return respond(idempotency.body, { status: idempotency.httpStatus })
    })
  }

  if (url.pathname === '/webhook/demo-forward') {
    if (integrityPaused) return policyPausedResponse()
    const workerNotify = readWorkerNotifyConfig()
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

    const breakerKey = resolveWorkerNotifyBreakerKey(workerNotify, provider)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${workerNotify.token}`,
      'content-type': 'application/json',
      'x-breaker-key': breakerKey,
    }
    if (workerNotify.hmacSecret) {
      const sig = crypto.createHmac('sha256', workerNotify.hmacSecret).update(body).digest('hex')
      headers['X-Signature'] = sig
    }
    const resp = await fetch(workerNotify.target, { method: 'POST', headers, body })
    if (resp.ok) return respond('forwarded', { status: 200 })
    return respond('notify_failed', { status: 502 })
  }
  // periodic sweep
  sweep()
  if (url.pathname === '/') markReadonlyFallback(integrityPaused)
  return respond('Gateway skeleton', { status: 200 })
}
