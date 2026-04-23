import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const baseEnv = {
  TEST_IN_MEMORY_KV: 1,
  ROUTE_ASSERT_TOKEN: 'route-token',
  ROUTE_ASSERT_SIGNATURE_REF: 'worker-ed25519-site',
  WORKER_ED25519_PRIV_HEX: '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100',
  AO_SITE_PROCESS_ID: 'site-process-placeholder',
  WRITE_PROCESS_ID: 'write-process-placeholder',
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

async function issueAssertion(envOverrides: Record<string, any> = {}) {
  const suffix = uniqueSuffix()
  const env = { ...baseEnv, ...envOverrides } as any
  const body = {
    domain: `demo-${suffix}.darkmesh.fun`,
    cfgTx: `Qz8d64GWY7L30I3e6ynXC49gv6G8pcO6lJG2Yr-${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`,
    hbHost: 'hyperbeam.darkmesh.fun',
    challengeNonce: `nonce-${suffix}`,
    challengeExp: Math.floor(Date.now() / 1000) + 300,
  }
  const req = new Request('http://localhost/route/assert', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.ROUTE_ASSERT_TOKEN}`,
    },
    body: JSON.stringify(body),
  })
  const res = await mod.fetch(req, env, {} as any)
  expect(res.status).toBe(200)
  const data = (await res.json()) as any
  return { env, data }
}

async function verifyOnce(env: Record<string, any>, payload: Record<string, unknown>) {
  const req = new Request('http://localhost/route/assert/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return mod.fetch(req, env as any, {} as any)
}

describe('/route/assert/verify replay guard', () => {
  it('allows repeated verification when replay guard is disabled (default)', async () => {
    const { env, data } = await issueAssertion({ ROUTE_ASSERT_VERIFY_REPLAY_ENABLED: '0' })
    const payload = {
      assertion: data.assertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
    }
    const first = await verifyOnce(env, payload)
    expect(first.status).toBe(200)
    const second = await verifyOnce(env, payload)
    expect(second.status).toBe(200)
  })

  it('rejects repeated verification with replay_detected when replay guard is enabled', async () => {
    const { env, data } = await issueAssertion({ ROUTE_ASSERT_VERIFY_REPLAY_ENABLED: '1' })
    const payload = {
      assertion: data.assertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
    }
    const first = await verifyOnce(env, payload)
    expect(first.status).toBe(200)
    const second = await verifyOnce(env, payload)
    expect(second.status).toBe(409)
    const body = (await second.json()) as any
    expect(body.error).toBe('replay_detected')
  })
})
