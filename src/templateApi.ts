import crypto from 'crypto'

import { inc } from './metrics.js'
import { loadIntegerConfig, loadStringConfig } from './runtime/config/loader.js'
import { requireAllowedRole } from './runtime/auth/policy.js'
import { bodyExceedsUtf8Limit, utf8ByteLength } from './runtime/core/index.js'
import { getTemplateActionPolicy, type BackendTarget, type TemplateActionPolicy } from './runtime/template/actions.js'
import type { RuntimeRoutingHints } from './runtime/template/siteResolver.js'
import { inspectTemplateSecretPayload, type TemplateSecretGuardResult } from './runtime/template/secretGuard.js'
import { getTemplateContractAction, type TemplateContractAction } from './templateContract.js'

type TemplateCallInput = {
  action: string
  payload: unknown
  requestId?: string
  siteId?: string
  runtimeHints?: RuntimeRoutingHints
  actor?: string
  role?: string
  traceId?: string
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

type TemplateUpstreamAuthMode = 'none' | 'bearer' | 'x-template-token'

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
type SignedWriteEnvelopeResult =
  | { ok: true; signature: string; signatureRef: string }
  | { ok: false; status: number; error: string; detail?: Record<string, unknown> }

type TemplateVariantMetadata = {
  variant: string
  templateTxId: string
  manifestTxId: string
}

type TemplateVariantResolveResult =
  | { ok: true; value: TemplateVariantMetadata | null }
  | { ok: false; status: number; error: string; detail?: Record<string, unknown> }

const DEFAULT_TEMPLATE_MAX_BODY_BYTES = 32_768
const DEFAULT_TEMPLATE_UPSTREAM_TIMEOUT_MS = 7_000
const DEFAULT_TEMPLATE_SIGN_TIMEOUT_MS = 5_000
const SAFE_TRACE_ID_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/
const SAFE_WRITE_PID_RE = /^[A-Za-z0-9_-]{20,128}$/
const WRITE_PID_OVERRIDE_HEADER = 'x-write-process-id'

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

function resolveTraceId(rawTraceId: string | undefined): string {
  const traceId = typeof rawTraceId === 'string' ? rawTraceId.trim() : ''
  if (SAFE_TRACE_ID_RE.test(traceId)) return traceId
  return crypto.randomUUID()
}

function resolveSiteId(input: TemplateCallInput): string | undefined {
  const explicitSiteId = asNonEmptyString(input.siteId)
  if (explicitSiteId) return explicitSiteId
  if (!isObj(input.payload)) return undefined
  return asNonEmptyString(input.payload.siteId)
}

function resolvePayloadSiteId(payload: unknown): string | undefined {
  if (!isObj(payload)) return undefined
  return asNonEmptyString(payload.siteId)
}

function resolveRuntimeHintValue(runtimeHints: RuntimeRoutingHints | undefined, keys: string[]): string | undefined {
  if (!runtimeHints) return undefined
  const records = [runtimeHints.runtime, runtimeHints.runtimePointers]
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const value = asNonEmptyString(record[key])
      if (value) return value
    }
  }
  return undefined
}

function resolveRuntimeWritePid(runtimeHints: RuntimeRoutingHints | undefined): string | undefined {
  return resolveRuntimeHintValue(runtimeHints, ['writeProcessId', 'writePid', 'write_process_id'])
}

function resolveRuntimeWorkerUrl(runtimeHints: RuntimeRoutingHints | undefined): string | undefined {
  return resolveRuntimeHintValue(runtimeHints, ['workerUrl', 'worker_url'])
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
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

function parseTemplateVariantMap(
  raw: string,
  envName: string,
): { ok: true; map: Record<string, TemplateVariantMetadata> } | { ok: false; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, message: `${envName} must be valid JSON` }
  }

  if (!isObj(parsed)) {
    return { ok: false, message: `${envName} must be an object` }
  }

  const map: Record<string, TemplateVariantMetadata> = {}
  for (const [siteIdRaw, entryRaw] of Object.entries(parsed)) {
    const siteId = siteIdRaw.trim()
    if (!siteId) {
      return { ok: false, message: `${envName} keys must be non-empty strings` }
    }
    if (!isObj(entryRaw)) {
      return {
        ok: false,
        message: `${envName} entries must be objects with variant, templateTxId, and manifestTxId`,
      }
    }

    const variant = asNonEmptyString(entryRaw.variant)
    const templateTxId = asNonEmptyString(entryRaw.templateTxId)
    const manifestTxId = asNonEmptyString(entryRaw.manifestTxId)
    if (!variant || !templateTxId || !manifestTxId) {
      return {
        ok: false,
        message: `${envName} entries must include non-empty variant, templateTxId, and manifestTxId`,
      }
    }

    map[siteId] = {
      variant,
      templateTxId,
      manifestTxId,
    }
  }

  return { ok: true, map }
}

function readStringEnv(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok) return undefined
  return asNonEmptyString(loaded.value)
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
  if (!loaded.ok) return fallback
  if (!Number.isFinite(loaded.value) || loaded.value <= 0) return fallback
  return Math.floor(loaded.value)
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
    const baseUrl = readStringEnv('AO_PUBLIC_API_URL') || readStringEnv('AO_READ_URL')
    if (!baseUrl) return { ok: false, status: 503, error: 'target_not_configured', detail: { target: 'ao' } }
    return { ok: true, value: baseUrl }
  }

  if (target === 'write') {
    const baseUrl = readStringEnv('WRITE_API_URL')
    if (!baseUrl) return { ok: false, status: 503, error: 'target_not_configured', detail: { target: 'write' } }
    return { ok: true, value: baseUrl }
  }

  const baseUrl = readStringEnv('WORKER_API_URL')
  if (!baseUrl) return { ok: false, status: 503, error: 'target_not_configured', detail: { target: 'worker' } }
  return { ok: true, value: baseUrl }
}

function resolveSignerBaseUrl(siteId: string, runtimeWorkerUrl?: string): ResolveResult {
  if (runtimeWorkerUrl) {
    return { ok: true, value: runtimeWorkerUrl }
  }
  const mapRaw = readStringEnv('GATEWAY_TEMPLATE_WORKER_URL_MAP')
  if (mapRaw) {
    const parsed = parseStringMap(mapRaw, 'GATEWAY_TEMPLATE_WORKER_URL_MAP')
    if (!parsed.ok) {
      return {
        ok: false,
        status: 500,
        error: 'worker_route_map_invalid',
        detail: { message: 'message' in parsed ? parsed.message : 'invalid_map' },
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

  const fallback = readStringEnv('WORKER_API_URL') || readStringEnv('WORKER_SIGN_URL')
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

function resolveSignerToken(siteId: string): ResolveResult {
  const mapRaw = readStringEnv('GATEWAY_TEMPLATE_WORKER_TOKEN_MAP')
  if (mapRaw) {
    const parsed = parseStringMap(mapRaw, 'GATEWAY_TEMPLATE_WORKER_TOKEN_MAP')
    if (!parsed.ok) {
      return {
        ok: false,
        status: 500,
        error: 'worker_token_map_invalid',
        detail: { message: 'message' in parsed ? parsed.message : 'invalid_map' },
      }
    }
    const mapped = parsed.map[siteId]
    if (mapped) return { ok: true, value: mapped }
  }

  const fallback = readStringEnv('WORKER_AUTH_TOKEN') || readStringEnv('WORKER_SIGN_TOKEN')
  if (!fallback) {
    return {
      ok: false,
      status: 503,
      error: 'signer_auth_not_configured',
      detail: { siteId },
    }
  }
  return { ok: true, value: fallback }
}

function resolveExpectedSignatureRef(siteId: string): ResolveResult {
  const mapRaw = readStringEnv('GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP')
  if (!mapRaw) {
    return { ok: true, value: '' }
  }

  const parsed = parseStringMap(mapRaw, 'GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP')
  if (!parsed.ok) {
    inc('gateway_template_signer_ref_map_invalid')
    return {
      ok: false,
      status: 500,
      error: 'worker_signature_ref_map_invalid',
      detail: { message: 'message' in parsed ? parsed.message : 'invalid_map' },
    }
  }

  const expected = parsed.map[siteId]
  if (!expected) {
    return { ok: true, value: '' }
  }

  return { ok: true, value: expected }
}

function resolveTemplateVariantMetadata(siteId: string | undefined): TemplateVariantResolveResult {
  if (!siteId) return { ok: true, value: null }

  const mapRaw = readStringEnv('GATEWAY_TEMPLATE_VARIANT_MAP')
  if (!mapRaw) return { ok: true, value: null }

  const parsed = parseTemplateVariantMap(mapRaw, 'GATEWAY_TEMPLATE_VARIANT_MAP')
  if (!parsed.ok) {
    return {
      ok: false,
      status: 500,
      error: 'template_variant_map_invalid',
      detail: { message: 'message' in parsed ? parsed.message : 'invalid_map' },
    }
  }

  const variantMetadata = parsed.map[siteId]
  if (!variantMetadata) return { ok: true, value: null }
  return { ok: true, value: variantMetadata }
}

function readTemplateUpstreamAuthMode(): TemplateUpstreamAuthMode {
  const raw = (readStringEnv('GATEWAY_TEMPLATE_UPSTREAM_AUTH_MODE') || 'none').toLowerCase()
  if (raw === 'bearer' || raw === 'x-template-token') return raw
  return 'none'
}

function resolveTemplateUpstreamToken(siteId: string | undefined): ResolveResult {
  const mapRaw = readStringEnv('GATEWAY_TEMPLATE_UPSTREAM_TOKEN_MAP')
  if (mapRaw) {
    const parsed = parseStringMap(mapRaw, 'GATEWAY_TEMPLATE_UPSTREAM_TOKEN_MAP')
    if (!parsed.ok) {
      return {
        ok: false,
        status: 500,
        error: 'upstream_token_map_invalid',
        detail: { message: 'message' in parsed ? parsed.message : 'invalid_map' },
      }
    }
    if (siteId) {
      const mapped = parsed.map[siteId]
      if (mapped) return { ok: true, value: mapped }
    }
  }

  const fallback = readStringEnv('GATEWAY_TEMPLATE_UPSTREAM_TOKEN')
  if (fallback) return { ok: true, value: fallback }
  return { ok: true, value: '' }
}

function hmacBody(body: string): string | undefined {
  const secret = readStringEnv('GATEWAY_TEMPLATE_HMAC_SECRET')
  if (!secret) return undefined
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function getTemplateMaxBodyBytes(): number {
  return readPositiveIntegerEnv('GATEWAY_TEMPLATE_MAX_BODY_BYTES', DEFAULT_TEMPLATE_MAX_BODY_BYTES)
}

function getTemplateUpstreamTimeoutMs(kind?: 'read' | 'write'): number {
  const fallback = readPositiveIntegerEnv('GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS', DEFAULT_TEMPLATE_UPSTREAM_TIMEOUT_MS)
  if (kind === 'read') {
    return readPositiveIntegerEnv('GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS_READ', fallback)
  }
  if (kind === 'write') {
    return readPositiveIntegerEnv('GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS_WRITE', fallback)
  }
  return fallback
}

function getTemplateSignTimeoutMs(): number {
  return readPositiveIntegerEnv('GATEWAY_TEMPLATE_SIGN_TIMEOUT_MS', DEFAULT_TEMPLATE_SIGN_TIMEOUT_MS)
}

function getTemplateTargetAllowlist(): string[] | null {
  const raw = readStringEnv('GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST')
  if (!raw) return null
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

function jsonError(status: number, error: string, detail?: Record<string, unknown>, traceId?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (traceId) headers['x-trace-id'] = traceId
  return new Response(
    JSON.stringify({
      error,
      ...(detail || {}),
    }),
    {
      status,
      headers,
    },
  )
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

function validateAllowlist(baseUrl: string, allowlist: string[] | null, traceId?: string): Response | null {
  if (!allowlist) return null

  let resolvedHost: string
  try {
    resolvedHost = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    inc('gateway_template_target_blocked')
    return jsonError(403, 'template_target_forbidden', {
      detail: 'upstream target is invalid',
      target: baseUrl,
    }, traceId)
  }

  if (allowlist.includes(resolvedHost)) return null

  inc('gateway_template_target_blocked')
  return jsonError(403, 'template_target_forbidden', {
    detail: 'upstream host is not in the allowlist',
    host: resolvedHost,
    allowlist,
  }, traceId)
}

function buildWriteSignEnvelope(input: TemplateCallInput, siteId: string, requestId: string, payload: unknown): SignedWriteEnvelope {
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
    payload,
  }
}

function injectTemplateVariant(payload: unknown, templateVariant: TemplateVariantMetadata | null): unknown {
  if (!templateVariant || !isObj(payload)) return payload
  return {
    ...payload,
    templateVariant,
  }
}

async function signWriteEnvelope(
  signerBaseUrl: string,
  signerToken: string,
  envelope: SignedWriteEnvelope,
  timeoutMs: number,
  traceId?: string,
): Promise<SignedWriteEnvelopeResult> {
  const signUrl = new URL('/sign', signerBaseUrl).toString()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${signerToken}`,
      'content-type': 'application/json',
    }
    if (traceId) headers['x-trace-id'] = traceId
    const response = await fetch(signUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        ok: false,
        status: response.status >= 500 ? 502 : 401,
        error: 'worker_sign_failed',
        detail: { upstreamStatus: response.status },
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

export async function proxyTemplateCall(input: TemplateCallInput): Promise<Response> {
  const traceId = resolveTraceId(input.traceId)
  const policy = getResolvedPolicy(input.action)
  if (!policy) return jsonError(403, 'action_not_allowed', undefined, traceId)

  const enforcedRole = policy.local.kind === 'write' ? policy.contract.auth.requiredRole : input.role

  if (policy.local.kind === 'write' && readStringEnv('GATEWAY_TEMPLATE_ALLOW_MUTATIONS') !== '1') {
    return jsonError(403, 'write_actions_disabled', undefined, traceId)
  }

  const roleCheck = requireAllowedRole(policy.contract.auth.requiredRole, enforcedRole, { publicRole: 'public' })
  if (!roleCheck.ok) {
    return jsonError(403, 'forbidden_role', {
      requiredRole: policy.contract.auth.requiredRole,
      providedRole: (typeof enforcedRole === 'string' && enforcedRole.trim().length > 0 ? enforcedRole : null),
    }, traceId)
  }

  const valid = policy.local.validate(input.payload)
  if (!valid.ok) {
    const detail = 'error' in valid ? valid.error : 'invalid_payload'
    return jsonError(400, 'invalid_payload', { detail }, traceId)
  }

  const secretGuard = inspectTemplateSecretPayload(input.payload)
  if (!secretGuard.ok) {
    const blocked = secretGuard as Extract<TemplateSecretGuardResult, { ok: false }>
    inc('gateway_template_secret_guard_blocked')
    return jsonError(blocked.status, blocked.error, blocked.detail, traceId)
  }

  const requestId = asNonEmptyString(input.requestId)
  if (policy.contract.idempotency.mode === 'required' && !requestId) {
    return jsonError(400, 'missing_request_id', {
      detail: 'x-request-id is required for this action',
    }, traceId)
  }

  const siteIdForVariantMap = resolveSiteId(input)
  const resolvedTemplateVariant = resolveTemplateVariantMetadata(siteIdForVariantMap)
  if (resolvedTemplateVariant.ok === false) {
    const templateVariantError = resolvedTemplateVariant as Extract<TemplateVariantResolveResult, { ok: false }>
    return jsonError(templateVariantError.status, templateVariantError.error, templateVariantError.detail, traceId)
  }
  const payloadWithTemplateVariant = injectTemplateVariant(input.payload, resolvedTemplateVariant.value)

  const resolvedTarget = resolveBackendBaseUrl(policy.local.target)
  if (resolvedTarget.ok === false) {
    const resolvedTargetError = resolvedTarget as Extract<ResolveResult, { ok: false }>
    return jsonError(resolvedTargetError.status, resolvedTargetError.error, resolvedTargetError.detail, traceId)
  }
  const baseUrl = (resolvedTarget as Extract<ResolveResult, { ok: true }>).value

  const allowlist = getTemplateTargetAllowlist()
  const baseUrlAllowError = validateAllowlist(baseUrl, allowlist, traceId)
  if (baseUrlAllowError) return baseUrlAllowError

  let effectiveRequestId = requestId
  let resolvedSiteId = asNonEmptyString(input.siteId)
  let writeEnvelope: Record<string, unknown> | null = null
  const runtimeWritePid = resolveRuntimeWritePid(input.runtimeHints)
  const runtimeWorkerUrl = resolveRuntimeWorkerUrl(input.runtimeHints)

  if (runtimeWritePid && !SAFE_WRITE_PID_RE.test(runtimeWritePid)) {
    return jsonError(502, 'invalid_runtime_write_process_id', { value: runtimeWritePid }, traceId)
  }
  if (runtimeWorkerUrl && !isValidHttpUrl(runtimeWorkerUrl)) {
    return jsonError(502, 'invalid_runtime_worker_url', { value: runtimeWorkerUrl }, traceId)
  }

  if (policy.local.kind === 'write') {
    const explicitSiteId = asNonEmptyString(input.siteId)
    const payloadSiteId = resolvePayloadSiteId(payloadWithTemplateVariant)
    if (explicitSiteId && payloadSiteId && explicitSiteId !== payloadSiteId) {
      return jsonError(400, 'site_id_mismatch', {
        detail: 'siteId and payload.siteId must match for write actions',
      }, traceId)
    }

    resolvedSiteId = explicitSiteId || payloadSiteId || resolveSiteId(input)
    if (!resolvedSiteId) {
      return jsonError(400, 'site_id_required', {
        detail: 'payload.siteId is required for write actions',
      }, traceId)
    }

    const signerBase = resolveSignerBaseUrl(resolvedSiteId, runtimeWorkerUrl)
    if (signerBase.ok === false) {
      const signerBaseError = signerBase as Extract<ResolveResult, { ok: false }>
      return jsonError(signerBaseError.status, signerBaseError.error, signerBaseError.detail, traceId)
    }

    const signerAllowError = validateAllowlist(signerBase.value, allowlist, traceId)
    if (signerAllowError) return signerAllowError

    const signerToken = resolveSignerToken(resolvedSiteId)
    if (signerToken.ok === false) {
      const signerTokenError = signerToken as Extract<ResolveResult, { ok: false }>
      return jsonError(signerTokenError.status, signerTokenError.error, signerTokenError.detail, traceId)
    }

    const expectedSignatureRef = resolveExpectedSignatureRef(resolvedSiteId)
    if (expectedSignatureRef.ok === false) {
      const expectedSignatureRefError = expectedSignatureRef as Extract<ResolveResult, { ok: false }>
      return jsonError(expectedSignatureRefError.status, expectedSignatureRefError.error, expectedSignatureRefError.detail, traceId)
    }

    effectiveRequestId = effectiveRequestId || `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const signEnvelope = buildWriteSignEnvelope(input, resolvedSiteId, effectiveRequestId, payloadWithTemplateVariant)
    const signerBaseUrl = (signerBase as Extract<ResolveResult, { ok: true }>).value
    const signed = await signWriteEnvelope(
      signerBaseUrl,
      signerToken.value,
      signEnvelope,
      getTemplateSignTimeoutMs(),
      traceId,
    )
    if (signed.ok === false) {
      const signedError = signed as Extract<SignedWriteEnvelopeResult, { ok: false }>
      return jsonError(signedError.status, signedError.error, signedError.detail, traceId)
    }

    if (expectedSignatureRef.value && signed.signatureRef !== expectedSignatureRef.value) {
      inc('gateway_template_signer_ref_mismatch')
      return jsonError(502, 'worker_sign_signature_ref_mismatch', {
        siteId: resolvedSiteId,
        expectedSignatureRef: expectedSignatureRef.value,
        actualSignatureRef: signed.signatureRef,
      }, traceId)
    }

    writeEnvelope = {
      ...signEnvelope,
      signature: signed.signature,
      signatureRef: signed.signatureRef,
      siteId: resolvedSiteId,
      role: policy.contract.auth.requiredRole,
      templateAction: input.action,
    }
  }

  const url = new URL(policy.local.path, baseUrl).toString()
  const body = JSON.stringify(
    writeEnvelope || {
      action: input.action,
      payload: payloadWithTemplateVariant,
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
    }, traceId)
  }

  const signature = hmacBody(body)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-template-action': input.action,
  }
  if (effectiveRequestId) headers['x-request-id'] = effectiveRequestId
  if (resolvedSiteId) headers['x-site-id'] = resolvedSiteId
  if (signature) headers['x-template-signature'] = signature
  if (policy.local.kind === 'write' && runtimeWritePid) headers[WRITE_PID_OVERRIDE_HEADER] = runtimeWritePid

  const upstreamAuthMode = readTemplateUpstreamAuthMode()
  const upstreamToken = resolveTemplateUpstreamToken(resolvedSiteId)
  if (upstreamToken.ok === false) {
    const upstreamTokenError = upstreamToken as Extract<ResolveResult, { ok: false }>
    return jsonError(upstreamTokenError.status, upstreamTokenError.error, upstreamTokenError.detail, traceId)
  }
  if (upstreamAuthMode !== 'none' && !upstreamToken.value) {
    return jsonError(503, 'template_upstream_auth_not_configured', {
      mode: upstreamAuthMode,
      siteId: resolvedSiteId,
    }, traceId)
  }
  if (upstreamToken.value && upstreamAuthMode === 'bearer') {
    headers.authorization = `Bearer ${upstreamToken.value}`
  }
  if (upstreamToken.value && upstreamAuthMode === 'x-template-token') {
    headers['x-template-token'] = upstreamToken.value
  }

  const timeoutMs = getTemplateUpstreamTimeoutMs(policy.local.kind)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let upstream: Response
  try {
    if (traceId) headers['x-trace-id'] = traceId
    upstream = await fetch(url, { method: policy.local.method, headers, body, signal: controller.signal })
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      inc('gateway_template_upstream_timeout')
      return jsonError(504, 'template_upstream_timeout', {
        detail: 'template upstream request exceeded the configured timeout',
        timeoutMs,
      }, traceId)
    }
    inc('gateway_template_call_backend_fail')
    return jsonError(502, 'template_upstream_error', {
      detail: 'template upstream request failed',
    }, traceId)
  } finally {
    clearTimeout(timer)
  }

  const upstreamBody = await upstream.text()

  return new Response(upstreamBody, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'x-trace-id': traceId,
    },
  })
}
