import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reset } from '../src/metrics.js'

const originalEnv = { ...process.env }

type Action = 'report' | 'ack' | 'pause' | 'resume'
type Family = 'reporter' | 'emergency'

type IncidentRecord = {
  action: Action
  paused: boolean
}

const reporterActions: Action[] = ['report', 'ack']
const emergencyActions: Action[] = ['pause', 'resume']

function clearIntegrityEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AO_INTEGRITY_') || key.startsWith('GATEWAY_INTEGRITY_')) {
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

function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!
}

function familyForAction(action: Action): Family {
  return action === 'pause' || action === 'resume' ? 'emergency' : 'reporter'
}

function oppositeAction(action: Action): Action {
  switch (action) {
    case 'report':
      return 'ack'
    case 'ack':
      return 'report'
    case 'pause':
      return 'resume'
    case 'resume':
      return 'pause'
  }
}

async function loadHandler() {
  return import('../src/handler.js')
}

async function readPaused(handleRequest: (req: Request) => Promise<Response>): Promise<boolean> {
  const res = await handleRequest(makeStateRequest())
  expect(res.status).toBe(200)
  const body = await res.json()
  return Boolean(body.policy?.paused)
}

async function makeHarness() {
  vi.resetModules()
  process.env = { ...originalEnv }
  clearIntegrityEnv()
  reset()

  process.env.GATEWAY_INTEGRITY_INCIDENT_TOKEN = 'incident-secret'
  process.env.GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF = '1'
  process.env.GATEWAY_INTEGRITY_ROLE_REPORTER_REFS = 'sig-reporter'
  process.env.GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS = 'sig-emergency'

  const { handleRequest } = await loadHandler()
  return { handleRequest }
}

function severityForAction(action: Action) {
  switch (action) {
    case 'report':
      return 'medium'
    case 'ack':
      return 'low'
    case 'pause':
      return 'critical'
    case 'resume':
      return 'high'
  }
}

describe('integrity transition formal invariants', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    clearIntegrityEnv()
    reset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    clearIntegrityEnv()
    vi.restoreAllMocks()
    reset()
  })

  it(
    'preserves pause/resume invariants across deterministic pseudo-random transition sequences',
    async () => {
    const seeds = [
      0x1a2b3c4d,
      0x5e6f7788,
      0x9abcdef0,
      0x10203040,
      0x55667788,
      0x89abcdef,
      0xfedcba98,
      0x0f1e2d3c,
      0x31415926,
      0x27182818,
      0xdeadbeef,
      0xc001d00d,
    ]
    const stepsPerSeed = 20

    for (const seed of seeds) {
      const { handleRequest } = await makeHarness()
      const rng = createRng(seed)
      const seen = new Map<string, IncidentRecord>()
      let expectedPaused = false
      let created = 0

      expect(await readPaused(handleRequest)).toBe(false)

      for (let step = 0; step < stepsPerSeed; step++) {
        const replay = seen.size > 0 && rng() < 0.4
        let incidentId: string
        let action: Action
        let expectedDuplicate = false

        if (replay) {
          const ids = [...seen.keys()]
          incidentId = pick(rng, ids)
          const prior = seen.get(incidentId)
          expect(prior).toBeDefined()
          action = rng() < 0.7 ? oppositeAction(prior!.action) : prior!.action
          expectedDuplicate = true
        } else {
          const family: Family = rng() < 0.55 ? 'emergency' : 'reporter'
          action = pick(rng, family === 'emergency' ? emergencyActions : reporterActions)
          incidentId = `seed-${seed.toString(16)}-${String(created).padStart(2, '0')}`
          created += 1
        }

        const signatureRef = familyForAction(action) === 'emergency' ? 'sig-emergency' : 'sig-reporter'
        const priorPaused = expectedPaused
        const request = makeIncidentRequest(
          {
            event: `${action}-${seed.toString(16)}-${step}`,
            action,
            incidentId,
            source: familyForAction(action) === 'emergency' ? 'ops' : 'monitoring',
            severity: severityForAction(action),
          },
          {
            'x-incident-token': 'incident-secret',
            'x-signature-ref': signatureRef,
          },
        )

        const res = await handleRequest(request)
        expect(res.status).toBe(200)
        const body = await res.json()

        if (expectedDuplicate) {
          const prior = seen.get(incidentId)
          expect(prior).toBeDefined()
          expect(body).toMatchObject({
            ok: true,
            duplicate: true,
            idempotent: true,
            incidentId,
            action: prior!.action,
            paused: prior!.paused,
            status: 'duplicate',
          })
          expect(expectedPaused).toBe(priorPaused)
        } else {
          const nextPaused = action === 'pause' ? true : action === 'resume' ? false : expectedPaused
          expect(body).toMatchObject({
            ok: true,
            incidentId,
            action,
            paused: nextPaused,
          })
          seen.set(incidentId, { action, paused: nextPaused })
          expectedPaused = nextPaused
          if (action === 'report' || action === 'ack') {
            expect(expectedPaused).toBe(priorPaused)
          } else {
            expect(expectedPaused).toBe(action === 'pause')
          }
        }

        expect(await readPaused(handleRequest)).toBe(expectedPaused)
      }
    }
    },
    30_000,
  )
})
