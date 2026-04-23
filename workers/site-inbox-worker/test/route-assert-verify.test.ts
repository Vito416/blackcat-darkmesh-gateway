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

const assertBody = {
  domain: 'demo.darkmesh.fun',
  cfgTx: 'Qz8d64GWY7L30I3e6ynXC49gv6G8pcO6lJG2Yr-km6w',
  hbHost: 'hyperbeam.darkmesh.fun',
  challengeNonce: 'nonce-12345678',
  challengeExp: Math.floor(Date.now() / 1000) + 600,
}

async function createAssertion(envOverrides: Record<string, any> = {}, bodyOverrides: Record<string, any> = {}) {
  const env = { ...baseEnv, ...envOverrides } as any
  const req = new Request('http://localhost/route/assert', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.ROUTE_ASSERT_TOKEN}`,
    },
    body: JSON.stringify({ ...assertBody, ...bodyOverrides }),
  })
  const res = await mod.fetch(req, env, {} as any)
  expect(res.status).toBe(200)
  const data = (await res.json()) as any
  return { env, data }
}

async function verifyAssertion(
  env: Record<string, any>,
  payload: Record<string, unknown>,
) {
  const req = new Request('http://localhost/route/assert/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return mod.fetch(req, env as any, {} as any)
}

describe('/route/assert/verify', () => {
  it('accepts a valid signed assertion', async () => {
    const { env, data } = await createAssertion()
    const res = await verifyAssertion(env, {
      assertion: data.assertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
      expectedDomain: 'demo.darkmesh.fun',
      expectedHbHost: 'hyperbeam.darkmesh.fun',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.verified).toBe(true)
    expect(body.assertionHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects when assertion is tampered', async () => {
    const { env, data } = await createAssertion()
    const tamperedAssertion = { ...data.assertion, cfgTx: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    const res = await verifyAssertion(env, {
      assertion: tamperedAssertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toBe('invalid_sig')
  })

  it('rejects expired assertions', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { env, data } = await createAssertion({}, { challengeExp: now + 1 })
    const waitMs = Math.max(1200, (data.assertion.exp - now + 1) * 1000)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    const res = await verifyAssertion(env, {
      assertion: data.assertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as any
    expect(body.error).toBe('expired_assertion')
  })

  it('fails with domain_mismatch / hbhost_mismatch when expected values do not match', async () => {
    const { env, data } = await createAssertion()
    const domainRes = await verifyAssertion(env, {
      assertion: data.assertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
      expectedDomain: 'other.darkmesh.fun',
    })
    expect(domainRes.status).toBe(409)
    const domainBody = (await domainRes.json()) as any
    expect(domainBody.error).toBe('domain_mismatch')

    const hbRes = await verifyAssertion(env, {
      assertion: data.assertion,
      signature: data.signature,
      sigAlg: data.sigAlg,
      signatureRef: data.signatureRef,
      expectedHbHost: 'hb.other.fun',
    })
    expect(hbRes.status).toBe(409)
    const hbBody = (await hbRes.json()) as any
    expect(hbBody.error).toBe('hbhost_mismatch')
  })

  it('returns bad_shape for malformed payload', async () => {
    const res = await verifyAssertion(baseEnv, {
      assertion: null,
      signature: 'abc',
      sigAlg: 'ed25519',
      signatureRef: 'worker-ed25519-site',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toBe('bad_shape')
  })
})
