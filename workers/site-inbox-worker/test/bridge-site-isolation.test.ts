import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const baseEnv = {
  TEST_IN_MEMORY_KV: 1,
  GATEWAY_TEMPLATE_TOKEN_MAP: JSON.stringify({
    'site-a': 'tok-a',
    'site-b': 'tok-b',
  }),
  GATEWAY_TEMPLATE_TOKEN_OPTIONAL: '0',
  GATEWAY_WRITE_AUTO_SIGN: '0',
}

async function call(
  path: string,
  body: Record<string, unknown>,
  envOverrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const env = { ...baseEnv, ...envOverrides } as any
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer tok-a',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  return mod.fetch(req, env, {} as any)
}

describe('Gateway bridge site isolation', () => {
  it('rejects /api/public requests when top-level and payload site differ', async () => {
    const res = await call('/api/public/page', {
      siteId: 'site-a',
      payload: { siteId: 'site-b', path: '/hello' },
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('site_id_mismatch')
  })

  it('rejects /api/public requests when header and body site differ', async () => {
    const res = await call(
      '/api/public/resolve-route',
      {
        siteId: 'site-a',
        payload: { siteId: 'site-a', path: '/hello' },
      },
      {},
      { 'x-bridge-site-id': 'site-b' },
    )
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('site_id_mismatch')
  })

  it('accepts canonical /api/public scope then continues to AO validation', async () => {
    const res = await call('/api/public/page', {
      siteId: 'site-a',
      payload: { siteId: 'site-a', path: '/hello' },
    })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_ao_site_process_id')
  })

  it('rejects checkout bypass attempt when payload site differs from authenticated site', async () => {
    const res = await call('/api/checkout/order', {
      action: 'CreateOrder',
      siteId: 'site-a',
      tenant: 'site-a',
      payload: { siteId: 'site-b', orderId: 'ord-1' },
      signature: 'deadbeef',
      signatureRef: 'worker-ed25519',
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('site_id_mismatch')
  })

  it('rejects checkout when tenant scope does not match authenticated site', async () => {
    const res = await call('/api/checkout/payment-intent', {
      action: 'CreatePaymentIntent',
      siteId: 'site-a',
      tenant: 'site-b',
      payload: { siteId: 'site-a', orderId: 'ord-2' },
      signature: 'deadbeef',
      signatureRef: 'worker-ed25519',
    })
    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('site_scope_mismatch')
  })

  it('accepts canonical checkout scope then continues to write-process validation', async () => {
    const res = await call('/api/checkout/order', {
      action: 'CreateOrder',
      siteId: 'site-a',
      tenant: 'site-a',
      payload: { siteId: 'site-a', orderId: 'ord-3' },
      signature: 'deadbeef',
      signatureRef: 'worker-ed25519',
    })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('missing_write_process_id')
  })
})
