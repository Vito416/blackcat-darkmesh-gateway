import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reset } from '../src/metrics.js'

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

function makeStateRequest() {
  return new Request('http://gateway/integrity/state')
}

type SequenceStep = {
  action: 'report' | 'ack' | 'pause' | 'resume'
  event: string
  incidentId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  signatureRef: string
}

type SequenceCase = {
  name: string
  steps: SequenceStep[]
  expectedPaused: boolean
}

async function readPaused(handleRequest: (req: Request) => Promise<Response>): Promise<boolean> {
  const res = await handleRequest(makeStateRequest())
  expect(res.status).toBe(200)
  const body = await res.json()
  return Boolean(body.policy?.paused)
}

async function loadHandler() {
  return import('../src/handler.js')
}

describe('integrity transition state machine', () => {
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

  const sequenceCases: SequenceCase[] = [
    {
      name: 'report and ack never leave the policy paused',
      expectedPaused: false,
      steps: [
        {
          action: 'report',
          event: 'integrity-warning',
          incidentId: 'sm-report-1',
          severity: 'medium',
          signatureRef: 'sig-reporter',
        },
        {
          action: 'ack',
          event: 'integrity-ack',
          incidentId: 'sm-ack-1',
          severity: 'low',
          signatureRef: 'sig-reporter',
        },
        {
          action: 'report',
          event: 'integrity-warning-repeat',
          incidentId: 'sm-report-2',
          severity: 'medium',
          signatureRef: 'sig-reporter',
        },
      ],
    },
    {
      name: 'pause survives interleaved read-only actions until an explicit resume',
      expectedPaused: false,
      steps: [
        {
          action: 'pause',
          event: 'manual-freeze',
          incidentId: 'sm-pause-1',
          severity: 'critical',
          signatureRef: 'sig-emergency',
        },
        {
          action: 'report',
          event: 'integrity-warning',
          incidentId: 'sm-report-3',
          severity: 'medium',
          signatureRef: 'sig-reporter',
        },
        {
          action: 'ack',
          event: 'integrity-ack',
          incidentId: 'sm-ack-2',
          severity: 'low',
          signatureRef: 'sig-reporter',
        },
        {
          action: 'resume',
          event: 'manual-unfreeze',
          incidentId: 'sm-resume-1',
          severity: 'high',
          signatureRef: 'sig-emergency',
        },
      ],
    },
    {
      name: 'a final pause stays active across mixed follow-up actions',
      expectedPaused: true,
      steps: [
        {
          action: 'ack',
          event: 'integrity-ack',
          incidentId: 'sm-ack-3',
          severity: 'low',
          signatureRef: 'sig-reporter',
        },
        {
          action: 'report',
          event: 'integrity-warning',
          incidentId: 'sm-report-4',
          severity: 'medium',
          signatureRef: 'sig-reporter',
        },
        {
          action: 'pause',
          event: 'manual-freeze',
          incidentId: 'sm-pause-2',
          severity: 'critical',
          signatureRef: 'sig-emergency',
        },
        {
          action: 'report',
          event: 'integrity-warning-after-pause',
          incidentId: 'sm-report-5',
          severity: 'medium',
          signatureRef: 'sig-reporter',
        },
      ],
    },
  ]

  it.each(sequenceCases)('$name', async ({ steps, expectedPaused }) => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
    process.env.GATEWAY_INTEGRITY_ROLE_REPORTER_REFS = 'sig-reporter'
    process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS = 'sig-emergency'

    const { handleRequest } = await loadHandler()

    expect(await readPaused(handleRequest)).toBe(false)
    let currentPaused = false

    for (const step of steps) {
      const nextPaused = step.action === 'pause' ? true : step.action === 'resume' ? false : currentPaused
      const res = await handleRequest(
        makeIncidentRequest(
          {
            event: step.event,
            action: step.action,
            incidentId: step.incidentId,
            source: 'ops',
            severity: step.severity,
          },
          {
            'x-incident-token': 'incident-secret',
            'x-signature-ref': step.signatureRef,
          },
        ),
      )

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        action: step.action,
        incidentId: step.incidentId,
        paused: nextPaused,
      })
      currentPaused = nextPaused
      expect(await readPaused(handleRequest)).toBe(currentPaused)
    }

    expect(currentPaused).toBe(expectedPaused)
  })

  it('keeps repeated pause and resume incidents idempotent and preserves the first side effect', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'

    const { handleRequest } = await loadHandler()
    const pauseIncidentId = 'sm-idem-pause-1'
    const resumeIncidentId = 'sm-idem-resume-1'

    const firstPause = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-freeze',
          action: 'pause',
          incidentId: pauseIncidentId,
          source: 'ops',
          severity: 'critical',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(firstPause.status).toBe(200)
    await expect(firstPause.json()).resolves.toMatchObject({
      ok: true,
      incidentId: pauseIncidentId,
      action: 'pause',
      paused: true,
    })

    const repeatedPause = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-freeze-duplicate',
          action: 'pause',
          incidentId: pauseIncidentId,
          source: 'ops',
          severity: 'critical',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(repeatedPause.status).toBe(200)
    await expect(repeatedPause.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      idempotent: true,
      incidentId: pauseIncidentId,
      action: 'pause',
      paused: true,
      status: 'duplicate',
    })

    const firstResume = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-unfreeze',
          action: 'resume',
          incidentId: resumeIncidentId,
          source: 'ops',
          severity: 'high',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(firstResume.status).toBe(200)
    await expect(firstResume.json()).resolves.toMatchObject({
      ok: true,
      incidentId: resumeIncidentId,
      action: 'resume',
      paused: false,
    })

    const repeatedResume = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-unfreeze-duplicate',
          action: 'resume',
          incidentId: resumeIncidentId,
          source: 'ops',
          severity: 'high',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(repeatedResume.status).toBe(200)
    await expect(repeatedResume.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      idempotent: true,
      incidentId: resumeIncidentId,
      action: 'resume',
      paused: false,
      status: 'duplicate',
    })

    expect(await readPaused(handleRequest)).toBe(false)
  })

  it('locks duplicate incident ids to the first transition and prevents later flips', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'

    const { handleRequest } = await loadHandler()
    const incidentId = 'incident-lock-001'

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
    expect(await readPaused(handleRequest)).toBe(true)

    const replayedResume = await handleRequest(
      makeIncidentRequest(
        {
          event: 'manual-unfreeze',
          action: 'resume',
          incidentId,
          source: 'ops',
          severity: 'high',
        },
        { 'x-incident-token': 'incident-secret' },
      ),
    )
    expect(replayedResume.status).toBe(200)
    await expect(replayedResume.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      idempotent: true,
      incidentId,
      action: 'pause',
      paused: true,
      status: 'duplicate',
    })
    expect(await readPaused(handleRequest)).toBe(true)
  })

  it('rejects unauthorized and forbidden incident actions without mutating paused state', async () => {
    process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
    process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
    process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS = 'sig-emergency'
    process.env.GATEWAY_INTEGRITY_ROLE_REPORTER_REFS = 'sig-reporter'

    const { handleRequest } = await loadHandler()

    expect(await readPaused(handleRequest)).toBe(false)

    const unauthorizedPause = await handleRequest(
      makeIncidentRequest({ event: 'manual-freeze', action: 'pause', severity: 'critical' }),
    )
    expect(unauthorizedPause.status).toBe(401)
    await expect(unauthorizedPause.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(await readPaused(handleRequest)).toBe(false)

    const forbiddenResume = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-unfreeze', action: 'resume', severity: 'high' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-not-allowed' },
      ),
    )
    expect(forbiddenResume.status).toBe(403)
    await expect(forbiddenResume.json()).resolves.toEqual({ error: 'forbidden_signature_ref' })
    expect(await readPaused(handleRequest)).toBe(false)

    const allowedPause = await handleRequest(
      makeIncidentRequest(
        { event: 'manual-freeze', action: 'pause', severity: 'critical' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-emergency' },
      ),
    )
    expect(allowedPause.status).toBe(200)
    await expect(allowedPause.json()).resolves.toMatchObject({ ok: true, action: 'pause', paused: true })

    const forbiddenAck = await handleRequest(
      makeIncidentRequest(
        { event: 'integrity-ack', action: 'ack', severity: 'low' },
        { 'x-incident-token': 'incident-secret', 'x-signature-ref': 'sig-not-allowed' },
      ),
    )
    expect(forbiddenAck.status).toBe(403)
    await expect(forbiddenAck.json()).resolves.toEqual({ error: 'forbidden_signature_ref' })
    expect(await readPaused(handleRequest)).toBe(true)
  })
})
