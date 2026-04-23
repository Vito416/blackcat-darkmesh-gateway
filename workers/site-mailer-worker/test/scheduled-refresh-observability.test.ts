import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'

const CFG_TX = 'c'.repeat(43)
const KID = 'd'.repeat(43)
const TXT_PAYLOAD = `v=dm1;cfg=${CFG_TX};kid=${KID};ttl=600`

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('scheduled refresh observability', () => {
  it('emits per-domain outcomes and summary log', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('_darkmesh.alpha.example')) {
        return new Response(
          JSON.stringify({
            Answer: [{ data: `"${TXT_PAYLOAD}"` }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.includes('_darkmesh.bad.example')) {
        return new Response(JSON.stringify({ Answer: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url === `https://arweave.net/${CFG_TX}`) {
        return new Response(
          JSON.stringify({
            domain: 'alpha.example',
            owner: KID,
            hbProbeUrl: 'https://hyperbeam.darkmesh.fun/health'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url === 'https://hyperbeam.darkmesh.fun/health') {
        return new Response('ok', { status: 200 })
      }
      return new Response('not_found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const pending: Promise<unknown>[] = []
    await worker.scheduled(
      { cron: '*/10 * * * *', scheduledTime: Date.now() },
      {
        REFRESH_DOMAINS: 'alpha.example,bad.example',
        HB_PROBE_ALLOWLIST: 'hyperbeam.darkmesh.fun'
      },
      {
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise)
        }
      }
    )
    await Promise.all(pending)

    const records = logSpy.mock.calls
      .map((call) => call[0])
      .filter((entry) => typeof entry === 'string')
      .map((entry) => JSON.parse(entry))

    const outcomes = records.filter((entry) => entry.event === 'refresh_outcome')
    expect(outcomes.some((entry) => entry.mode === 'scheduled' && entry.domain === 'alpha.example')).toBe(true)
    expect(
      outcomes.some(
        (entry) => entry.mode === 'scheduled' && entry.domain === 'bad.example' && entry.code === 'txt_not_found'
      )
    ).toBe(true)

    const summary = records.find((entry) => entry.event === 'scheduled_refresh_complete')
    expect(summary).toBeTruthy()
    expect(summary.mode).toBe('scheduled')
    expect(summary.code).toBe('partial_failure')
    expect(summary.attempted).toBe(2)
    expect(summary.ok).toBe(1)
    expect(summary.failed).toBe(1)
    expect(typeof summary.latencyMs).toBe('number')
  })
})
