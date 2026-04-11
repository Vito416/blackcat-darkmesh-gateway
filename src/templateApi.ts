import crypto from 'crypto'

import { inc } from './metrics.js'
import { bodyExceedsUtf8Limit, readPositiveInteger, utf8ByteLength } from './runtime/core/bytes.js'
import { getTemplateActionPolicy, type BackendTarget, type TemplateActionPolicy } from './runtime/template/actions.js'
import { getTemplateContractAction, type TemplateContractAction } from './templateContract.js'

type TemplateCallInput = {
  action: string
  payload: unknown
  requestId?: string
  siteId?: string
  actor?: string
  role?: string
}

type ResolveResult =
  | {
      ok: true
      value: string
    }
  | {
      ok: false
      status: number
      error: string
      detail?: Record<string, unknown>
    }

type ResolvedTemplatePolicy = {
  local: TemplateActionPolicy
  contract: TemplateContractAction
}

type SignedWriteEnvelope = {
  action: string
  requestId: string
  actor: string
  tenant: string
  timestamp: number
  nonce: string
  payload: unknown
}

const DEFAULT_TEMPLATE_MAX_BODY_BYTES = 32_768
const DEFAULT_TEMPLATE_UPSTREAM_TIMEOUT_MS = 7_000
const DEFAULT_TEMPLATE_SIGN_TIMEOUT_MS = 5_000

const TEMPLATE_TO_WRITE_ACTION: Record<string, string> = {
  'checkout.create-order': 'CreateOrder',
  'checkout.create-payment-intent': 'CreatePaymentIntent',
}

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeRole(value: unknown): string | undefined {
  const role = asNonEmptyString(value)
  return role ? role.toLowerCase() : undefined
}

function resolveSiteId(input: TemplateCallInput): string | undefined {
  const explicitSiteId = asNonEmptyString(input.siteId)
  if (explicitSiteId) return explicitSiteId
  if (!isObj(input.payload)) return undefined
  return asNonEmptyString(input.payload.siteId)
}

function parseStringMap(raw: string, envName: string): { ok: true; map: Record<string, string> } | { ok: false; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, message: `${envName} must be valid JSON` }
  }
  if (!isObj(parsed)) {
    return { ok: false, message: `${envName} must be an object` }
  }

  const map: Record<string, string> = {}
  for (const [keyRaw, valueRaw] of Object.entries(parsed)) {
    const key = keyRaw.trim()
    const value = asNonEmptyString(valueRaw)
    if (!key || !value) {
      return {
        ok: false,
        message: `${envName} keys and values must be non-empty strings`,
      }
    }
    map[key] = value
  }

  return { ok: true, map }
}

function getResolvedPolicy(action: string): ResolvedTemplatePolicy | undefined {
  const local = getTemplateActionPolicy(action)
  if (!local) return undefined

  const contract = getTemplateContractAction(action)
  if (!contract) return undefined

  if (contract.method !== local.method) return undefined
  if (contract.path !== local.path) return undefined

  return { local, contract }
}

function resolveBackendBaseUrl(target: BackendTarget): ResolveResult {
  if (target === 'ao') {
    const baseUrl = process.env.AO_PUBLIC_API_URL || process.env.AO_READ_URL || undefined
    if (!baseUrl) return { ok: false, status: 503, error: 'target_not_configured', detail: { target: 'ao' } }
    return { ok: true, value: baseUrl }
  }

  if (target === 'write') {
    const baseUrl = process.env.WRITE_API_URL || undefined
    if (!baseUrl) return { ok: false, status: 503, error: 'target_not_configured', detail: { target: 'write' } }
    return { ok: true, value: baseUrl }
  }

  const baseUrl = process.env.WORKER_API_URL || undefined
  if (!baseUrl) return { ok: false, status: 503, error: 'target_not_configured', detail: { target: 'worker' } }
  return { ok: true, value: baseUrl }
}

function resolveSignerBaseUrl(siteId: string): ResolveResult {
  const mapRaw = (process.env.GATEWAY_TEMPLATE_WORKER_URL_MAP || '').trim()
  if (mapRaw) {
    const parsed = parseStringMap(mapRaw, 'GATEWAY_TEMPLATE_WORKER_URL_MAP')
    if (!parsed.ok) {
      return {
        ok: false,
        status: 500,
        error: 'worker_route_map_invalid',
        detail: { message: parsed.message },
      }
    }
    const mapped = parsed.map[siteId]
    if (!mapped) {
      return {
        ok: false,
        status: 503,
        error: 'worker_target_not_configured',
        detail: { siteId },
      }
    }
    return { ok: true, value: mapped }
  }

  const fallback = process.env.WORKER_API_URL || process.env.WORKER_SIGN_URL || undefined
  if (!fallback) {
    return {
      ok: false,
      status: 503,
      error: 'signer_not_configured',
      detail: { siteId },
    }
  }

  return { ok: true, value: fallback }
}

function resolveSignerToken(siteId: string): string | undefined {
  const mapRaw = (process.env.GATEWAY_TEMPLATE_WORKER_TOKEN_MAP || '').trim()
  if (mapRaw) {
    const parsed = parseStringMap(mapRaw, 'GATEWAY_TEMPLATE_WORKER_TOKEN_MAP')
    if (parsed.ok) {
      const mapped = parsed.map[siteId]
      if (mapped) return mapped
    }
  }

  return asNonEmptyString(process.env.WORKER_AUTH_TOKEN) || asNonEmptyString(process.env.WORKER_SIGN_TOKEN)
}

function hmacBody(body: string): string | undefined {
  const secret = process.env.GATEWAY_TEMPLATE_HMAC_SECRET
  if (!secret) return undefined
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function getTemplateMaxBodyBytes(): number {
  return readPositiveInteger(process.env.GATEWAY_TEMPLATE_MAX_BODY_BYTES, DEFAULT_TEMPLATE_MAX_BODY_BYTES)
}

function getTemplateUpstreamTimeoutMs(): number {
  return readPositiveInteger(process.env.GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS, DEFAULT_TEMPLATE_UPSTREAM_TIMEOUT_MS)
}

function getTemplateSignTimeoutMs(): number {
  return readPositiveInteger(process.env.GATEWAY_TEMPLATE_SIGN_TIMEOUT_MS, DEFAULT_TEMPLATE_SIGN_TIMEOUT_MS)
}

function getTemplateTargetAllowlist(): string[] | null {
  const raw = (process.env.GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST || '').trim()
  if (!raw) return null
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

function jsonError(status: number, error: string, detail?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      error,
      ...(detail || {}),
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  )
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

function validateAllowlist(baseUrl: string, allowlist: string[] | null): Response | null {
  if (!allowlist) return null

  let resolvedHost: string
  try {
    resolvedHost = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    inc('gateway_template_target_blocked')
    return jsonError(403, 'template_target_forbidden', {
      detail: 'upstream target is invalid',
      target: baseUrl,
    })
  }

  if (allowlist.includes(resolvedHost)) return null

  inc('gateway_template_target_blocked')
  return jsonError(403, 'template_target_forbidden', {
    detail: 'upstream host is not in the allowlist',
    host: resolvedHost,
    allowlist,
  })
}

function buildWriteSignEnvelope(input: TemplateCallInput, siteId: string, requestId: string): SignedWriteEnvelope {
  const action = TEMPLATE_TO_WRITE_ACTION[input.action] || input.action
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = `gw-${crypto.randomBytes(12).toString('hex')}`
  const actor = asNonEmptyString(input.actor) || 'gateway-template'
  const tenant = siteId
  return {
    action,
    requestId,
    actor,
    tenant,
    timestamp,
    nonce,
    payload: input.payload,
  }
}

async function signWriteEnvelope(
  signerBaseUrl: string,
  signerToken: string,
  envelope: SignedWriteEnvelope,
  timeoutMs: number,
): Promise<{ ok: true; signature: string; signatureRef: string } | { ok: false; status: number; error: string; detail?: Record<string, unknown> }> {
  const signUrl = new URL('/sign', signerBaseUrl).toString()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(signUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      return {
        ok: false,
        status: response.status >= 500 ? 502 : 401,
        error: 'worker_sign_failed',
        detail: { upstreamStatus: response.status, body: bodyText.slice(0, 256) },
      }
    }

    const json = await response.json().catch(() => null)
    const signature = asNonEmptyString(json?.signature)
    const signatureRef = asNonEmptyString(json?.signatureRef)
    if (!signature || !signatureRef) {
      return {
        ok: false,
        status: 502,
        error: 'worker_sign_invalid_response',
      }
    }

    return { ok: true, signature, signatureRef }
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      return {
        ok: false,
        status: 504,
        error: 'worker_sign_timeout',
        detail: { timeoutMs },
      }
    }
    return {
      ok: false,
      status: 502,
      error: 'worker_sign_unreachable',
    }
  } finally {
    clearTimeout(timer)
  }
}

function isRoleAllowed(requiredRole: string, role: string | undefined): boolean {
  const required = normalizeRole(requiredRole)
  if (!required || required === 'public') return true
  const provided = normalizeRole(role)
  return !!provided && provided === required
}

export async function proxyTemplateCall(input: TemplateCallInput): Promise<Response> {
  const policy = getResolvedPolicy(input.action)
  if (!policy) return jsonError(403, 'action_not_allowed')

  if (policy.local.kind === 'write' && process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS !== '1') {
    return jsonError(403, 'write_actions_disabled')
  }

  if (!isRoleAllowed(policy.contract.auth.requiredRole, input.role)) {
    return jsonError(403, 'forbidden_role', {
      requiredRole: policy.contract.auth.requiredRole,
      providedRole: input.role || null,
    })
  }

  const valid = policy.local.validate(input.payload)
  if (!valid.ok) {
    const detail = 'error' in valid ? valid.error : 'invalid_payload'
    return jsonError(400, 'invalid_payload', { detail })
  }

  const requestId = asNonEmptyString(input.requestId)
  if (policy.contract.idempotency.mode === 'required' && !requestId) {
    return jsonError(400, 'missing_request_id', {
      detail: 'x-request-id is required for this action',
    })
  }

  const resolvedTarget = resolveBackendBaseUrl(policy.local.target)
  if (!resolvedTarget.ok) {
    return jsonError(resolvedTarget.status, resolvedTarget.error, resolvedTarget.detail)
  }
  const baseUrl = resolvedTarget.value

  const allowlist = getTemplateTargetAllowlist()
  const baseUrlAllowError = validateAllowlist(baseUrl, allowlist)
  if (baseUrlAllowError) return baseUrlAllowError

  let effectiveRequestId = requestId
  let resolvedSiteId = asNonEmptyString(input.siteId)
  let writeEnvelope: Record<string, unknown> | null = null

  if (policy.local.kind === 'write') {
    resolvedSiteId = resolveSiteId(input)
    if (!resolvedSiteId) {
      return jsonError(400, 'site_id_required', {
        detail: 'payload.siteId is required for write actions',
      })
    }

    const signerBase = resolveSignerBaseUrl(resolvedSiteId)
    if (!signerBase.ok) {
      return jsonError(signerBase.status, signerBase.error, signerBase.detail)
    }

    const signerAllowError = validateAllowlist(signerBase.value, allowlist)
    if (signerAllowError) return signerAllowError

    const signerToken = resolveSignerToken(resolvedSiteId)
    if (!signerToken) {
      return jsonError(503, 'signer_auth_not_configured', { siteId: resolvedSiteId })
    }

    effectiveRequestId = effectiveRequestId || `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const signEnvelope = buildWriteSignEnvelope(input, resolvedSiteId, effectiveRequestId)
    const signed = await signWriteEnvelope(signerBase.value, signerToken, signEnvelope, getTemplateSignTimeoutMs())
    if (!signed.ok) {
      return jsonError(signed.status, signed.error, signed.detail)
    }

    writeEnvelope = {
      ...signEnvelope,
      signature: signed.signature,
      signatureRef: signed.signatureRef,
      siteId: resolvedSiteId,
      role: input.role,
      templateAction: input.action,
    }
  }

  const url = new URL(policy.local.path, baseUrl).toString()
  const body = JSON.stringify(
    writeEnvelope || {
      action: input.action,
      payload: input.payload,
      requestId: effectiveRequestId,
      siteId: resolvedSiteId,
      actor: input.actor,
      role: input.role,
    },
  )

  const maxBodyBytes = getTemplateMaxBodyBytes()
  if (bodyExceedsUtf8Limit(body, maxBodyBytes)) {
    const bodyBytes = utf8ByteLength(body)
    inc('gateway_template_reject_size')
    return jsonError(413, 'template_body_too_large', {
      detail: 'template call body exceeds the configured byte limit',
      maxBodyBytes,
      actualBytes: bodyBytes,
    })
  }

  const signature = hmacBody(body)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-template-action': input.action,
  }
  if (effectiveRequestId) headers['x-request-id'] = effectiveRequestId
  if (resolvedSiteId) headers['x-site-id'] = resolvedSiteId
  if (signature) headers['x-template-signature'] = signature

  const timeoutMs = getTemplateUpstreamTimeoutMs()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let upstream: Response
  try {
    upstream = await fetch(url, { method: policy.local.method, headers, body, signal: controller.signal })
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      inc('gateway_template_upstream_timeout')
      return jsonError(504, 'template_upstream_timeout', {
        detail: 'template upstream request exceeded the configured timeout',
        timeoutMs,
      })
    }
    inc('gateway_template_call_backend_fail')
    return jsonError(502, 'template_upstream_error', {
      detail: 'template upstream request failed',
    })
  } finally {
    clearTimeout(timer)
  }

  const upstreamBody = await upstream.text()

  return new Response(upstreamBody, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
  })
}
