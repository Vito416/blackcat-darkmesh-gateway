import crypto from 'crypto'

import { inc } from './metrics.js'
import { getTemplateActionPolicy, type BackendTarget, type TemplateActionPolicy } from './runtime/template/actions.js'
import { getTemplateContractAction } from './templateContract.js'

type TemplateCallInput = {
  action: string
  payload: unknown
  requestId?: string
  siteId?: string
  actor?: string
}

const DEFAULT_TEMPLATE_MAX_BODY_BYTES = 32_768
const DEFAULT_TEMPLATE_UPSTREAM_TIMEOUT_MS = 7_000

function getPolicy(action: string): TemplateActionPolicy | undefined {
  const localPolicy = getTemplateActionPolicy(action)
  if (!localPolicy) return undefined

  const contractPolicy = getTemplateContractAction(action)
  if (!contractPolicy) return undefined

  if (contractPolicy.method !== localPolicy.method) return undefined
  if (contractPolicy.path !== localPolicy.path) return undefined

  return localPolicy
}

function resolveBaseUrl(target: BackendTarget): string | undefined {
  if (target === 'ao') return process.env.AO_PUBLIC_API_URL || process.env.AO_READ_URL || undefined
  if (target === 'write') return process.env.WRITE_API_URL || undefined
  return process.env.WORKER_API_URL || undefined
}

function hmacBody(body: string): string | undefined {
  const secret = process.env.GATEWAY_TEMPLATE_HMAC_SECRET
  if (!secret) return undefined
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

function getTemplateMaxBodyBytes(): number {
  return readPositiveInteger(process.env.GATEWAY_TEMPLATE_MAX_BODY_BYTES, DEFAULT_TEMPLATE_MAX_BODY_BYTES)
}

function getTemplateUpstreamTimeoutMs(): number {
  return readPositiveInteger(process.env.GATEWAY_TEMPLATE_UPSTREAM_TIMEOUT_MS, DEFAULT_TEMPLATE_UPSTREAM_TIMEOUT_MS)
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

export async function proxyTemplateCall(input: TemplateCallInput): Promise<Response> {
  const policy = getPolicy(input.action)
  if (!policy) return jsonError(403, 'action_not_allowed')

  if (policy.kind === 'write' && process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS !== '1') {
    return jsonError(403, 'write_actions_disabled')
  }

  const valid = policy.validate(input.payload)
  if (!valid.ok) {
    const detail = 'error' in valid ? valid.error : 'invalid_payload'
    return jsonError(400, 'invalid_payload', { detail })
  }

  const baseUrl = resolveBaseUrl(policy.target)
  if (!baseUrl) {
    return jsonError(503, 'target_not_configured', { target: policy.target })
  }

  const allowlist = getTemplateTargetAllowlist()
  if (allowlist) {
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

    if (!allowlist.includes(resolvedHost)) {
      inc('gateway_template_target_blocked')
      return jsonError(403, 'template_target_forbidden', {
        detail: 'upstream host is not in the allowlist',
        host: resolvedHost,
        allowlist,
      })
    }
  }

  const url = new URL(policy.path, baseUrl).toString()
  const body = JSON.stringify({
    action: input.action,
    payload: input.payload,
    requestId: input.requestId,
    siteId: input.siteId,
    actor: input.actor,
  })
  const bodyBytes = Buffer.byteLength(body)
  const maxBodyBytes = getTemplateMaxBodyBytes()
  if (bodyBytes > maxBodyBytes) {
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
  if (input.requestId) headers['x-request-id'] = input.requestId
  if (input.siteId) headers['x-site-id'] = input.siteId
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
    upstream = await fetch(url, { method: policy.method, headers, body, signal: controller.signal })
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
