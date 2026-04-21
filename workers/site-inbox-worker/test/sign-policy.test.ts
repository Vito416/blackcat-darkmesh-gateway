import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const baseEnv = {
  TEST_IN_MEMORY_KV: 1,
  INBOX_TTL_DEFAULT: '60',
  INBOX_TTL_MAX: '300',
  SUBJECT_MAX_ENVELOPES: '5',
  PAYLOAD_MAX_BYTES: '20480',
  RATE_LIMIT_MAX: '5',
  RATE_LIMIT_WINDOW: '60',
  SIGN_RATE_LIMIT_MAX: '100',
  REPLAY_TTL: '600',
  NOTIFY_RETRY_MAX: '1',
  NOTIFY_RETRY_BACKOFF_MS: '0',
  NOTIFY_BREAKER_THRESHOLD: '2',
  FORGET_TOKEN: 't',
  WORKER_AUTH_TOKEN: 't',
  WORKER_SIGN_TOKEN: 't',
  WORKER_ED25519_PRIV_HEX:
    '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100',
}

function nextNonce() {
  return `nonce-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

async function call(path: string, init: RequestInit, envOverrides: Record<string, any>) {
  const env = { ...baseEnv, ...envOverrides } as any
  const req = new Request(`http://localhost${path}`, init)
  return mod.fetch(req, env, {} as any)
}

function signBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    action: 'CreateOrder',
    tenant: 'blackcat',
    actor: 'worker-test',
    role: 'admin',
    timestamp: Math.floor(Date.now() / 1000),
    nonce: nextNonce(),
    signatureRef: 'worker-ed25519-site-demo',
    payload: { siteId: 'site-demo', orderId: 'ord-1' },
    ...overrides,
  })
}

describe('Worker sign policy', () => {
  const policy = JSON.stringify({
    sites: {
      'site-demo': {
        CreateOrder: ['admin', 'support'],
      },
    },
    signatureRefs: {
      'worker-ed25519-site-demo': {
        CreateOrder: ['admin'],
      },
    },
  })
  const controlPlanePolicy = JSON.stringify({
    sites: {
      'site-demo': {
        RegisterSite: ['admin'],
      },
    },
    signatureRefs: {
      'worker-ed25519-site-demo': {
        RegisterSite: ['admin'],
      },
    },
  })

  it('keeps legacy signing behavior when no policy is configured', async () => {
    const body = signBody()
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      {},
    )

    expect(res.status).toBe(200)
  })

  it('fails closed when SIGN_POLICY_REQUIRED=1 and no policy is configured', async () => {
    const body = signBody()
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_REQUIRED: '1' },
    )

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_sign_policy')
  })

  it('requires WORKER_SIGN_TOKEN for /sign', async () => {
    const body = signBody()
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { WORKER_SIGN_TOKEN: '' },
    )

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_sign_token')
  })

  it('returns 400 invalid_json for malformed /sign payload', async () => {
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body: '{',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      {},
    )

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('invalid_json')
  })

  it('uses ts precedence for freshness checks when both ts and timestamp are present', async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 3600
    const body = signBody({ timestamp: Math.floor(Date.now() / 1000), ts: oldTs })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      {},
    )

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('stale_timestamp')
  })

  it('fails closed when SIGN_TS_WINDOW is invalid', async () => {
    const body = signBody()
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_TS_WINDOW: 'invalid' },
    )

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('invalid_sign_ts_window')
  })

  it('fails closed when policy is configured without any allowlist rules', async () => {
    const body = signBody()
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: '{}' },
    )

    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('sign_policy_empty')
  })

  it('allows a request that matches the site and signatureRef allowlists', async () => {
    const body = signBody()
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )

    expect(res.status).toBe(200)
    const json = await res.json<any>()
    expect(json.signatureRef).toBe('worker-ed25519-site-demo')
    expect(typeof json.signature).toBe('string')
    expect(json.signature.length).toBeGreaterThan(0)
  })

  it('rejects a disallowed role for an otherwise allowed action', async () => {
    const body = signBody({ role: 'support' })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )

    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('sign_role_not_allowed_for_signature_ref')
  })

  it('rejects a disallowed action for a configured site and signatureRef', async () => {
    const body = signBody({ action: 'DeleteOrder' })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )

    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('sign_action_not_allowed_for_site')
  })

  it('blocks control-plane actions by default even when policy allows them', async () => {
    const body = signBody({ action: 'RegisterSite' })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: controlPlanePolicy },
    )

    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('sign_control_plane_action_blocked')
  })

  it('allows control-plane signing only when explicitly enabled', async () => {
    const body = signBody({ action: 'RegisterSite' })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      {
        SIGN_POLICY_JSON: controlPlanePolicy,
        ALLOW_CONTROL_PLANE_SIGN: '1',
      },
    )

    expect(res.status).toBe(200)
  })

  it('rejects mismatched top-level and payload site identifiers', async () => {
    const body = signBody({ siteId: 'site-demo', payload: { siteId: 'site-other', orderId: 'ord-1' } })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('site_id_mismatch')
  })

  it('rejects mismatched signatureRef aliases before policy evaluation', async () => {
    const body = signBody({
      signatureRef: 'worker-ed25519-site-demo',
      'Signature-Ref': 'worker-ed25519-site-other',
    })
    const res = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('signature_ref_mismatch')
  })

  it('rejects replayed nonce on /sign', async () => {
    const nonce = nextNonce()
    const timestamp = Math.floor(Date.now() / 1000)
    const body = signBody({ nonce, timestamp })

    const first = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )
    expect(first.status).toBe(200)

    const second = await call(
      '/sign',
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer t',
        },
      },
      { SIGN_POLICY_JSON: policy },
    )
    expect(second.status).toBe(409)
    const text = await second.text()
    expect(text).toContain('replay')
  })
})
