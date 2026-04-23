import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const baseEnv = {
  TEST_IN_MEMORY_KV: 1,
  ROUTE_ASSERT_TOKEN: 'route-token',
  WORKER_ED25519_PRIV_HEX: '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100',
  AO_SITE_PROCESS_ID: 'site-process-placeholder',
  WRITE_PROCESS_ID: 'write-process-placeholder',
}

const requestBody = {
  domain: 'Example.COM.',
  cfgTx: 'Qz8d64GWY7L30I3e6ynXC49gv6G8pcO6lJG2Yr-km6w',
  hbHost: 'HyperBeam.Darkmesh.fun',
  challengeNonce: 'nonce-12345678',
  challengeExp: Math.floor(Date.now() / 1000) + 300,
}

async function callRouteAssert(envOverrides: Record<string, any> = {}, bodyOverrides: Record<string, any> = {}, auth = true) {
  const env = { ...baseEnv, ...envOverrides } as any
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = `Bearer ${env.ROUTE_ASSERT_TOKEN || 'route-token'}`
  const req = new Request('http://localhost/route/assert', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...requestBody, ...bodyOverrides }),
  })
  return mod.fetch(req, env, {} as any)
}

describe('/route/assert', () => {
  it('returns a signed assertion for a valid request', async () => {
    const res = await callRouteAssert()
    expect(res.status).toBe(200)
    const payload = (await res.json()) as any
    expect(payload.ok).toBe(true)
    expect(payload.sigAlg).toBe('ed25519')
    expect(payload.assertion.domain).toBe('example.com')
    expect(payload.assertion.hbHost).toBe('hyperbeam.darkmesh.fun')
    expect(payload.assertion.siteProcess).toBe('site-process-placeholder')
    expect(payload.assertion.writeProcess).toBe('write-process-placeholder')
    expect(payload.assertion.entryPath).toBe('/')
    expect(payload.signature).toMatch(/^[a-f0-9]{128}$/)
    expect(payload.assertion.exp).toBeGreaterThan(payload.assertion.iat)
  })

  it('rejects unauthorized requests', async () => {
    const res = await callRouteAssert({}, {}, false)
    expect(res.status).toBe(401)
    const text = await res.text()
    expect(text).toContain('unauthorized')
  })

  it('fails closed when ROUTE_ASSERT_TOKEN is missing', async () => {
    const res = await callRouteAssert({ ROUTE_ASSERT_TOKEN: '' })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_route_assert_token')
  })

  it('returns controlled 500 when signing key is missing', async () => {
    const res = await callRouteAssert({ WORKER_ED25519_PRIV_HEX: '' })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_route_assert_signing_key')
  })

  it('rejects hbHost outside allowlist', async () => {
    const res = await callRouteAssert(
      { HB_ALLOWED_HOSTS: 'hyperbeam.darkmesh.fun' },
      { hbHost: 'evil.example.com' },
    )
    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('hb_host_not_allowlisted')
  })

  it('increments route-assert metrics counters', async () => {
    await callRouteAssert()
    await callRouteAssert({}, {}, false)
    const metricsRes = await mod.fetch(new Request('http://localhost/metrics'), baseEnv as any, {} as any)
    expect(metricsRes.status).toBe(200)
    const metrics = await metricsRes.text()
    expect(metrics).toContain('worker_route_assert_ok_total')
    expect(metrics).toContain('worker_route_assert_auth_failed_total')
  })
})
