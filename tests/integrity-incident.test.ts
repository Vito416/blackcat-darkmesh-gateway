import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reset, snapshot } from '../src/metrics.js'

const originalEnv = { ...process.env }

function clearIntegrityAoEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AO_INTEGRITY_')) {
      delete process.env[key]
    }
  }
}

function makeIncidentRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://gateway/integrity/incident', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function makeIncidentRawRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('http://gateway/integrity/incident', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
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
    clearIntegrityAoEnv()
    reset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    clearIntegrityAoEnv()
    vi.restoreAllMocks()
    reset()
  })

  async function loadHandler() {
    return import('../src/handler.js')
  }

  async function readPaused(handleRequest: (req: Request) => Promise<Response>): Promise<boolean> {
    const res = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(res.status).toBe(200)
    const body = await res.json()
    return Boolean(body.policy?.paused)
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
    const metrics = snapshot()
    expect(metrics.gauges.gateway_integrity_audit_seq_from).toBe(10)
    expect(metrics.gauges.gateway_integrity_audit_seq_to).toBe(11)
    expect(metrics.gauges.gateway_integrity_checkpoint_age_seconds).toBeGreaterThanOrEqual(0)
  })

  it('enforces signature-ref role policy for incident actions when enabled', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
    process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS = 'sig-emergency-v1,sig-emergency-v2'

    const { handleRequest } = await loadHandler()

    const denied = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', severity: 'critical' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-reporter-v1' },
      ),
    )
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toEqual({ error: 'forbidden_signature_ref' })

    const allowed = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', severity: 'critical' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-emergency-v2' },
      ),
    )
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toMatchObject({ ok: true, action: 'pause' })

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_incident_role_blocked).toBe(1)
  })

  it('allows snapshot authority refs for role-gated incident actions', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
    process.env.AO_INTEGRITY_URL = 'https://ao.example/integrity'
    process.env.GATEWAY_INTEGRITY_CACHE_TTL_MS = '60000'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeIntegritySnapshot(false)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', severity: 'critical' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-emergency' },
      ),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, action: 'pause' })
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

  it('rejects oversized incident bodies before auth and validation', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_MAX_BODY_BYTES = '64'

    const { handleRequest } = await loadHandler()
    const oversized = makeIncidentRawRequest(
      JSON.stringify({
        event: 'manual-freeze',
        action: 'pause',
        details: 'x'.repeat(256),
      }),
    )

    const res = await handleRequest(oversized)
    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({
      error: 'payload_too_large',
      retryable: false,
    })

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_incident_reject_size).toBe(1)
  })

  it('keeps runtime paused state unchanged when incident auth or role checks fail', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
    process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS = 'sig-emergency'
    process.env.GATEWAY_INTEGRITY_ROLE_REPORTER_REFS = 'sig-reporter'

    const { handleRequest } = await loadHandler()

    const initialState = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(initialState.status).toBe(200)
    await expect(initialState.json()).resolves.toMatchObject({ policy: { paused: false } })

    const unauthorizedPause = await handleRequest(
      makeIncidentRequest({ event: 'manual-freeze', action: 'pause', severity: 'critical' }),
    )
    expect(unauthorizedPause.status).toBe(401)
    await expect(unauthorizedPause.json()).resolves.toEqual({ error: 'unauthorized' })

    const stateAfterUnauthorized = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(stateAfterUnauthorized.status).toBe(200)
    await expect(stateAfterUnauthorized.json()).resolves.toMatchObject({ policy: { paused: false } })

    const forbiddenResume = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-unfreeze', action: 'resume', severity: 'high' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-not-allowed' },
      ),
    )
    expect(forbiddenResume.status).toBe(403)
    await expect(forbiddenResume.json()).resolves.toEqual({ error: 'forbidden_signature_ref' })

    const stateAfterForbidden = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(stateAfterForbidden.status).toBe(200)
    await expect(stateAfterForbidden.json()).resolves.toMatchObject({ policy: { paused: false } })
  })

  it.each([
    {
      name: 'invalid json body',
      request: (token: string) =>
        makeIncidentRawRequest('{not-json', {
          'x-incident-token': token,
          'x-signature-ref': 'sig-emergency',
        }),
      expectedStatus: 400,
      expectedBody: { error: 'invalid_json' },
    },
    {
      name: 'missing event field',
      request: (token: string) =>
        makeIncidentRequest(
          { action: 'pause', severity: 'critical' },
          { 'x-incident-token': token, 'x-signature-ref': 'sig-emergency' },
        ),
      expectedStatus: 400,
      expectedBody: { error: 'event_required' },
    },
    {
      name: 'invalid action field',
      request: (token: string) =>
        makeIncidentRequest(
          { event: 'manual-freeze', action: 'flip', severity: 'critical' },
          { 'x-incident-token': token, 'x-signature-ref': 'sig-emergency' },
        ),
      expectedStatus: 400,
      expectedBody: { error: 'invalid_action' },
    },
    {
      name: 'invalid severity field',
      request: (token: string) =>
        makeIncidentRequest(
          { event: 'manual-freeze', action: 'pause', severity: 'urgent' },
          { 'x-incident-token': token, 'x-signature-ref': 'sig-emergency' },
        ),
      expectedStatus: 400,
      expectedBody: { error: 'invalid_severity' },
    },
    {
      name: 'invalid source field',
      request: (token: string) =>
        makeIncidentRequest(
          { event: 'manual-freeze', action: 'pause', source: 'x'.repeat(129), severity: 'critical' },
          { 'x-incident-token': token, 'x-signature-ref': 'sig-emergency' },
        ),
      expectedStatus: 400,
      expectedBody: { error: 'invalid_source' },
    },
    {
      name: 'invalid incident id field',
      request: (token: string) =>
        makeIncidentRequest(
          {
            event: 'manual-freeze',
            action: 'pause',
            incidentId: 'x'.repeat(129),
            severity: 'critical',
          },
          { 'x-incident-token': token, 'x-signature-ref': 'sig-emergency' },
        ),
      expectedStatus: 400,
      expectedBody: { error: 'invalid_incident_id' },
    },
  ])(
    'keeps paused state unchanged for $name',
    async ({ request, expectedStatus, expectedBody }) => {
      process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
      process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
      process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS = 'sig-emergency'
      process.env.GATEWAY_INTEGRITY_ROLE_REPORTER_REFS = 'sig-reporter'

      const { handleRequest } = await loadHandler()
      expect(await readPaused(handleRequest)).toBe(false)

      const res = await handleRequest(request('incident-secret'))
      expect(res.status).toBe(expectedStatus)
      await expect(res.json()).resolves.toEqual(expectedBody)
      expect(await readPaused(handleRequest)).toBe(false)
    },
  )

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
    await expect(blockedWrite.json()).resolves.toEqual({
      error: 'policy_paused',
      reason: 'integrity_policy_paused',
      paused: true,
      retryable: false,
    })

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

    const state = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(state.status).toBe(200)
    await expect(state.json()).resolves.toMatchObject({ policy: { paused: false } })
    expect(snapshot().gauges.gateway_integrity_policy_paused).toBe(0)
  })

  it('deduplicates replayed incident ids and preserves the first applied side effect', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'

    const { handleRequest } = await loadHandler()
    const incidentId = 'incident-replay-001'

    const first = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-freeze',
          action: 'pause',
          incidentId,
          source: 'ops',
          severity: 'critical',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({
      ok: true,
      incidentId,
      action: 'pause',
      paused: true,
    })

    const duplicate = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-unfreeze',
          action: 'resume',
          incidentId,
          source: 'ops',
          severity: 'critical',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )

    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      idempotent: true,
      incidentId,
      action: 'pause',
      paused: true,
      status: 'duplicate',
    })

    const metrics = snapshot()
    expect(metrics.counters.gateway_integrity_incident).toBe(1)
    expect(metrics.counters.gateway_integrity_incident_duplicate).toBe(1)

    const state = await handleRequest(new Request('http://gateway/integrity/state'))
    expect(state.status).toBe(200)
    await expect(state.json()).resolves.toMatchObject({ policy: { paused: true } })
  })

  it('expires replay ids after the configured ttl and stops deduping stale incidents', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REPLAY_TTL_MS = '1'
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)

    const { handleRequest } = await loadHandler()
    const incidentId = 'ttl-expire-001'

    const first = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', incidentId, source: 'ops', severity: 'critical' },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(first.status).toBe(200)

    nowSpy.mockReturnValue(1005)
    const second = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-unfreeze', action: 'resume', incidentId, source: 'ops', severity: 'critical' },
        { 'x-incident-token': 'incident-secret' },
      ),
    )

    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({
      ok: true,
      incidentId,
      action: 'resume',
      paused: false,
    })

    expect(snapshot().counters.gateway_integrity_incident_duplicate).toBeUndefined()
  })

  it('evicts the oldest replay ids when the cache cap is exceeded', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REPLAY_CAP = '1'
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(2000)

    const { handleRequest } = await loadHandler()

    const first = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-freeze',
          action: 'pause',
          incidentId: 'cap-evict-001',
          source: 'ops',
          severity: 'critical',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(first.status).toBe(200)

    nowSpy.mockReturnValue(2001)
    const second = await handleRequest(
      makeIncidentRequest(
        {
          event: 'routine-report',
          action: 'report',
          incidentId: 'cap-evict-002',
          source: 'ops',
          severity: 'medium',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(second.status).toBe(200)

    nowSpy.mockReturnValue(2002)
    const third = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-thaw',
          action: 'resume',
          incidentId: 'cap-evict-001',
          source: 'ops',
          severity: 'critical',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )

    expect(third.status).toBe(200)
    await expect(third.json()).resolves.toMatchObject({
      ok: true,
      incidentId: 'cap-evict-001',
      action: 'resume',
      paused: false,
    })

    expect(snapshot().counters.gateway_integrity_incident_duplicate).toBeUndefined()
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

  it('returns 500 when signature-ref enforcement is enabled but no refs are configured', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'

    const { handleRequest } = await loadHandler()
    const res = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', severity: 'critical' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-any' },
      ),
    )

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'incident_ref_policy_not_configured' })
  })
})
