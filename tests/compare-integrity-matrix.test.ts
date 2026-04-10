import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRunPlan,
  compareMatrix,
  parseArgs,
  renderHumanSummary,
  renderJsonSummary,
  runCli,
} from '../scripts/compare-integrity-matrix.js'

function stateSnapshot(overrides = {}) {
  return {
    policy: {
      paused: false,
      activeRoot: 'root-a',
      activePolicyHash: 'hash-a',
      ...overrides.policy,
    },
    release: {
      version: '1.2.0',
      root: 'root-a',
      ...overrides.release,
    },
    audit: {
      seqTo: 10,
      ...overrides.audit,
    },
  }
}

function makeFetch(fixtures) {
  return vi.fn(async (input) => {
    const url = input instanceof URL ? input.toString() : String(input)
    const fixture = fixtures[url]

    if (fixture instanceof Error) {
      throw fixture
    }

    if (!fixture) {
      return new Response('not found', { status: 404, statusText: 'Not Found' })
    }

    if (fixture.ok === false) {
      return new Response(fixture.body ?? 'error', {
        status: fixture.status ?? 503,
        statusText: fixture.statusText ?? 'Service Unavailable',
        headers: { 'content-type': 'text/plain' },
      })
    }

    return new Response(JSON.stringify(fixture.body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

describe('compare-integrity-matrix.js', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('parses urls, tokens, mode, and json flags', () => {
    const args = parseArgs([
      '--url',
      'https://gw-a.example',
      '--url',
      'https://gw-b.example',
      '--token',
      'secret',
      '--mode',
      'all',
      '--json',
    ])

    expect(args).toEqual({
      help: false,
      urls: ['https://gw-a.example', 'https://gw-b.example'],
      tokens: ['secret'],
      mode: 'all',
      json: true,
    })
  })

  it('rejects malformed arguments and invalid mode values', () => {
    expect(() => parseArgs(['--url', 'https://gw-a.example', '--url'])).toThrow('missing value for --url')
    expect(() => parseArgs(['--url', 'https://gw-a.example', '--url', 'https://gw-b.example', '--mode', 'sideways'])).toThrow(
      'invalid --mode value: sideways',
    )
    expect(() => parseArgs(['--url', 'https://gw-a.example', '--url', 'https://gw-b.example', '--bogus'])).toThrow(
      'unknown option: --bogus',
    )
  })

  it('builds adjacent pairwise runs and one all-gateway run', () => {
    const urls = ['https://gw-a.example', 'https://gw-b.example', 'https://gw-c.example']

    expect(buildRunPlan(urls, 'pairwise')).toEqual([
      { type: 'pairwise', name: 'pair-1', indices: [0, 1] },
      { type: 'pairwise', name: 'pair-2', indices: [1, 2] },
    ])

    expect(buildRunPlan(urls, 'all')).toEqual([{ type: 'all', name: 'all', indices: [0, 1, 2] }])
  })

  it('aggregates a fully passing pairwise matrix', async () => {
    const fetchImpl = makeFetch({
      'https://gw-a.example/integrity/state': { body: stateSnapshot() },
      'https://gw-b.example/integrity/state': { body: stateSnapshot() },
      'https://gw-c.example/integrity/state': { body: stateSnapshot() },
    })

    const summary = await compareMatrix({
      urls: ['https://gw-a.example', 'https://gw-b.example', 'https://gw-c.example'],
      tokens: ['shared-token'],
      mode: 'pairwise',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      envToken: '',
    })

    expect(summary.exitCode).toBe(0)
    expect(summary.counts).toEqual({ total: 2, pass: 2, mismatch: 0, failure: 0 })
    expect(summary.runs.map((run) => run.status)).toEqual(['PASS', 'PASS'])
    expect(renderHumanSummary(summary)).toContain('Aggregate: 2 pass, 0 mismatch, 0 failure')
  })

  it('marks adjacent drift as mismatch in pairwise mode', async () => {
    const fetchImpl = makeFetch({
      'https://gw-a.example/integrity/state': { body: stateSnapshot() },
      'https://gw-b.example/integrity/state': {
        body: stateSnapshot({ release: { version: '1.2.1', root: 'root-b' } }),
      },
      'https://gw-c.example/integrity/state': { body: stateSnapshot() },
    })

    const summary = await compareMatrix({
      urls: ['https://gw-a.example', 'https://gw-b.example', 'https://gw-c.example'],
      tokens: ['shared-token'],
      mode: 'pairwise',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      envToken: '',
    })

    expect(summary.exitCode).toBe(3)
    expect(summary.counts).toEqual({ total: 2, pass: 0, mismatch: 2, failure: 0 })
    expect(summary.runs[0].status).toBe('MISMATCH')
    expect(summary.runs[1].status).toBe('MISMATCH')
    expect(renderJsonSummary(summary)).toContain('"exitCode": 3')
  })

  it('treats fetch failures as exit code 2 and preserves other run results', async () => {
    const fetchImpl = makeFetch({
      'https://gw-a.example/integrity/state': { body: stateSnapshot() },
      'https://gw-b.example/integrity/state': new Error('ECONNRESET'),
      'https://gw-c.example/integrity/state': { body: stateSnapshot() },
    })

    const summary = await compareMatrix({
      urls: ['https://gw-a.example', 'https://gw-b.example', 'https://gw-c.example'],
      tokens: ['shared-token'],
      mode: 'all',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      envToken: '',
    })

    expect(summary.exitCode).toBe(2)
    expect(summary.counts).toEqual({ total: 1, pass: 0, mismatch: 0, failure: 1 })
    expect(summary.runs[0]).toMatchObject({
      status: 'FAIL',
      outcome: 'failure',
    })
    expect(summary.runs[0].reason).toContain('#2 gw-b.example')
  })

  it('treats incomplete snapshots as payload failures', async () => {
    const fetchImpl = makeFetch({
      'https://gw-a.example/integrity/state': { body: stateSnapshot() },
      'https://gw-b.example/integrity/state': { body: { policy: { paused: false }, release: { version: '1.2.0' }, audit: {} } },
    })

    const summary = await compareMatrix({
      urls: ['https://gw-a.example', 'https://gw-b.example'],
      tokens: ['shared-token'],
      mode: 'all',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      envToken: '',
    })

    expect(summary.exitCode).toBe(2)
    expect(summary.counts.failure).toBe(1)
    expect(summary.runs[0].reason).toContain('incomplete')
  })

  it('returns a human-readable help response from the CLI runner', async () => {
    const result = await runCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('pairwise (default)')
    expect(result.output).toContain('compares adjacent gateways only')
  })
})
