import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reset, snapshot } from '../src/metrics.js'

const originalEnv = { ...process.env }

function makeIncidentRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://gateway/integrity/incident', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function makeTemplateWriteRequest() {
  return new Request('http://gateway/template/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'checkout.create-order',
      payload: { siteId: 'site-1', items: [{ sku: 'sku-1', qty: 1 }] },
    }),
  })
}

function makeIntegritySnapshot(paused: boolean) {
  return {
    release: {
      componentId: 'gateway',
      version: '1.4.0',
      root: 'root-abc',
      uriHash: 'uri-123',
      metaHash: 'meta-456',
      publishedAt: '2026-04-09T00:00:00Z',
    },
    policy: {
      activeRoot: 'root-abc',
      activePolicyHash: 'policy-789',
      paused,
      maxCheckInAgeSec: 3600,
    },
    authority: {
      root: 'sig-root',
      upgrade: 'sig-upgrade',
      emergency: 'sig-emergency',
      reporter: 'sig-reporter',
      signatureRefs: ['sig-root'],
    },
    audit: {
      seqFrom: 10,
      seqTo: 11,
      merkleRoot: 'merkle-xyz',
      metaHash: 'audit-meta',
      reporterRef: 'sig-reporter',
      acceptedAt: '2026-04-09T00:00:00Z',
    },
  }
}

describe('integrity incident and state endpoints', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    reset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    reset()
  })

  async function loadHandler() {
    return import('../src/handler.js')
  }

  it('guards /integrity/state with optional token auth and returns policy payload', async () => {
    process.env.GATEWAY_INTEGRITY_STATE_TOKEN = 'state-secret'

    const { handleRequest } = await loadHandler()
    const denied = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toEqual({ error: 'unauthorized' })

    const allowed = await handleRequest(
      new Request('http://gateway/integrity/state', {
        headers: { authorization: 'Bearer state-secret' },
      }),
    )
    expect(allowed.status).toBe(200)

    const body = await allowed.json()
    expect(body.policy.paused).toBe(false)
    expect(body.policy.source).toBe('env')
    expect(body.policy.activeRoot).toBeNull()

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_state_auth_blocked).toBe(1)
    expect(metrics.counters.gateway_integrity_state_read).toBe(1)
  })

  it('returns AO-backed integrity state when AO snapshot endpoint is configured', async () => {
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.GATEWAY_INTEGRITY_CACHE_TTL_MS = '60000'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeIntegritySnapshot(true)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.policy.paused).toBe(true)
    expect(body.policy.source).toBe('ao')
    expect(body.policy.activeRoot).toBe('root-abc')
    expect(body.release.version).toBe('1.4.0')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('requires incident auth token and validates incident payload', async () => {
    const { handleRequest } = await loadHandler()

    const misconfigured = await handleRequest(makeIncidentRequest({ event: 'test' }))
    expect(misconfigured.status).toBe(500)
    await expect(misconfigured.text()).resolves.toBe('incident_auth_not_configured')

    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    vi.resetModules()
    const { handleRequest: guarded } = await loadHandler()

    const denied = await guarded(makeIncidentRequest({ event: 'test' }))
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toEqual({ error: 'unauthorized' })

    const invalid = await guarded(
      makeIncidentRequest(
        { event: 'x'.repeat(200), action: 'unknown' },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: 'event_required' })

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_incident_auth_blocked).toBe(1)
  })

  it('applies pause/resume actions to runtime integrity policy', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_TEMPLATE_ALLOW_MUTATIONS = '1'
    process.env.WRITE_API_URL = 'https://write.example'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { handleRequest } = await loadHandler()

    const pause = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', source: 'ops', severity: 'critical' },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(pause.status).toBe(200)
    await expect(pause.json()).resolves.toMatchObject({ ok: true, paused: true, action: 'pause' })

    const blockedWrite = await handleRequest(makeTemplateWriteRequest())
    expect(blockedWrite.status).toBe(503)
    await expect(blockedWrite.json()).resolves.toEqual({ error: 'policy_paused' })

    const resume = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-unfreeze', action: 'resume', source: 'ops', severity: 'high' },
        { authorization: 'Bearer incident-secret' },
      ),
    )
    expect(resume.status).toBe(200)
    await expect(resume.json()).resolves.toMatchObject({ ok: true, paused: false, action: 'resume' })

    const allowedWrite = await handleRequest(makeTemplateWriteRequest())
    expect(allowedWrite.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(snapshot().gauges.gateway_integrity_policy_paused).toBe(0)
  })

  it('forwards incident notifications and records notify metrics', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_URL = 'https://worker.example/incident'
    process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_TOKEN = 'notify-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_HMAC = 'notify-hmac'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      makeIncidentRequest(
        { event: 'integrity_warning', action: 'report', severity: 'medium' },
        { 'x-incident-token': 'incident-secret' },
      ),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, action: 'report' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [input, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('https://worker.example/incident')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer notify-secret',
      'content-type': 'application/json',
    })
    expect((init.headers as Record<string, string>)['x-signature']).toMatch(/^[a-f0-9]{64}$/)

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_incident).toBe(1)
    expect(metrics.counters.gateway_integrity_incident_notify_ok).toBe(1)
  })

  it('returns 502 and increments notify-fail metric when incident forward fails', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_NOTIFY_URL = 'https://worker.example/incident'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }))

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      makeIncidentRequest(
        { event: 'integrity_warning', action: 'report', severity: 'medium' },
        { 'x-incident-token': 'incident-secret' },
      ),
    )

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'incident_notify_failed', status: 503 })
    expect(snapshot().counters.gateway_integrity_incident_notify_fail).toBe(1)
  })
})
