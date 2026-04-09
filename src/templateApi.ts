import crypto from 'crypto'

type BackendTarget = 'ao' | 'write' | 'worker'
type ActionKind = 'read' | 'write'

type ValidateResult = { ok: true } | { ok: false; error: string }
type Validator = (payload: unknown) => ValidateResult

type TemplateActionPolicy = {
  action: string
  kind: ActionKind
  target: BackendTarget
  path: string
  method: 'POST'
  validate: Validator
}

type TemplateCallInput = {
  action: string
  payload: unknown
  requestId?: string
  siteId?: string
  actor?: string
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function hasStr(v: Record<string, unknown>, key: string): boolean {
  return typeof v[key] === 'string' && (v[key] as string).trim().length > 0
}

function validateResolveRoute(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'host')) return { ok: false, error: 'payload.host is required' }
  if (!hasStr(payload, 'path')) return { ok: false, error: 'payload.path is required' }
  return { ok: true }
}

function validateGetPage(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'siteId')) return { ok: false, error: 'payload.siteId is required' }
  if (!hasStr(payload, 'slug')) return { ok: false, error: 'payload.slug is required' }
  return { ok: true }
}

function validateCreateOrder(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'siteId')) return { ok: false, error: 'payload.siteId is required' }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, error: 'payload.items must be a non-empty array' }
  }
  return { ok: true }
}

function validateCreatePaymentIntent(payload: unknown): ValidateResult {
  if (!isObj(payload)) return { ok: false, error: 'payload must be an object' }
  if (!hasStr(payload, 'orderId')) return { ok: false, error: 'payload.orderId is required' }
  if (!hasStr(payload, 'provider')) return { ok: false, error: 'payload.provider is required' }
  const provider = String(payload.provider).toLowerCase()
  if (!['stripe', 'paypal', 'gopay'].includes(provider)) {
    return { ok: false, error: 'payload.provider must be stripe|paypal|gopay' }
  }
  return { ok: true }
}

const policies: TemplateActionPolicy[] = [
  {
    action: 'public.resolve-route',
    kind: 'read',
    target: 'ao',
    path: '/api/public/resolve-route',
    method: 'POST',
    validate: validateResolveRoute,
  },
  {
    action: 'public.get-page',
    kind: 'read',
    target: 'ao',
    path: '/api/public/page',
    method: 'POST',
    validate: validateGetPage,
  },
  {
    action: 'checkout.create-order',
    kind: 'write',
    target: 'write',
    path: '/api/checkout/order',
    method: 'POST',
    validate: validateCreateOrder,
  },
  {
    action: 'checkout.create-payment-intent',
    kind: 'write',
    target: 'write',
    path: '/api/checkout/payment-intent',
    method: 'POST',
    validate: validateCreatePaymentIntent,
  },
]

function getPolicy(action: string): TemplateActionPolicy | undefined {
  return policies.find((p) => p.action === action)
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

export async function proxyTemplateCall(input: TemplateCallInput): Promise<Response> {
  const policy = getPolicy(input.action)
  if (!policy) return new Response(JSON.stringify({ error: 'action_not_allowed' }), { status: 403 })

  if (policy.kind === 'write' && process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS !== '1') {
    return new Response(JSON.stringify({ error: 'write_actions_disabled' }), { status: 403 })
  }

  const valid = policy.validate(input.payload)
  if (!valid.ok) {
    const detail = 'error' in valid ? valid.error : 'invalid_payload'
    return new Response(JSON.stringify({ error: 'invalid_payload', detail }), { status: 400 })
  }

  const baseUrl = resolveBaseUrl(policy.target)
  if (!baseUrl) {
    return new Response(JSON.stringify({ error: 'target_not_configured', target: policy.target }), { status: 503 })
  }

  const url = new URL(policy.path, baseUrl).toString()
  const body = JSON.stringify({
    action: input.action,
    payload: input.payload,
    requestId: input.requestId,
    siteId: input.siteId,
    actor: input.actor,
  })
  const signature = hmacBody(body)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-template-action': input.action,
  }
  if (input.requestId) headers['x-request-id'] = input.requestId
  if (input.siteId) headers['x-site-id'] = input.siteId
  if (signature) headers['x-template-signature'] = signature

  const upstream = await fetch(url, { method: policy.method, headers, body })
  const upstreamBody = await upstream.text()

  return new Response(upstreamBody, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
  })
}
