import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDispatchUrl,
  dispatchWorkflow,
  parseArgs,
  resolveDefaultRef,
  runCli,
} from '../scripts/dispatch-consistency-smoke.js'

describe('dispatch-consistency-smoke.js', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('parses and normalizes workflow dispatch arguments', () => {
    const args = parseArgs(
      [
        '--owner',
        'Vito416',
        '--repo',
        'blackcat-darkmesh-gateway',
        '--consistency-urls',
        ' https://gw-a.example , https://gw-b.example ',
        '--consistency-token',
        'cons-token',
        '--evidence-urls',
        'https://ev-a.example',
        '--evidence-token',
        'ev-token',
      ],
      {
        GITHUB_REF_NAME: 'feature/dispatch-helper',
      },
      () => 'ignored',
    )

    expect(args).toEqual({
      owner: 'Vito416',
      repo: 'blackcat-darkmesh-gateway',
      workflow: 'ci.yml',
      ref: 'feature/dispatch-helper',
      dryRun: false,
      consistencyUrls: 'https://gw-a.example,https://gw-b.example',
      consistencyToken: 'cons-token',
      evidenceUrls: 'https://ev-a.example',
      evidenceToken: 'ev-token',
    })
  })

  it('rejects blank and malformed csv inputs', () => {
    expect(() =>
      parseArgs(
        ['--owner', 'Vito416', '--repo', 'blackcat-darkmesh-gateway', '--consistency-urls', '   '],
        {},
        () => 'main',
      ),
    ).toThrow('--consistency-urls must not be blank')

    expect(() =>
      parseArgs(
        ['--owner', 'Vito416', '--repo', 'blackcat-darkmesh-gateway', '--consistency-urls', 'https://ok,ftp://bad'],
        {},
        () => 'main',
      ),
    ).toThrow('unsupported url protocol in --consistency-urls: ftp://bad')

    expect(() =>
      parseArgs(
        ['--owner', 'Vito416', '--repo', 'blackcat-darkmesh-gateway', '--evidence-urls', 'https://ok,,https://also-ok'],
        {},
        () => 'main',
      ),
    ).toThrow('--evidence-urls must not contain blank entries')
  })

  it('resolves the current ref from env, git, and main fallback', () => {
    expect(resolveDefaultRef({ env: { GITHUB_REF_NAME: 'feature/x' }, execGit: () => 'git-branch' })).toBe('feature/x')
    expect(resolveDefaultRef({ env: { GITHUB_HEAD_REF: 'pr-123' }, execGit: () => 'git-branch' })).toBe('pr-123')
    expect(resolveDefaultRef({ env: { GITHUB_REF: 'refs/heads/release/1.2.1' }, execGit: () => 'git-branch' })).toBe(
      'release/1.2.1',
    )
    expect(resolveDefaultRef({ env: {}, execGit: () => 'git-branch' })).toBe('git-branch')
    expect(resolveDefaultRef({ env: {}, execGit: () => '' })).toBe('main')
  })

  it('builds the GitHub dispatch url', () => {
    expect(buildDispatchUrl('Vito416', 'blackcat-darkmesh-gateway', 'ci.yml').toString()).toBe(
      'https://api.github.com/repos/Vito416/blackcat-darkmesh-gateway/actions/workflows/ci.yml/dispatches',
    )
  })

  it('dispatches a workflow with the expected payload and headers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    )

    const result = await dispatchWorkflow({
      owner: 'Vito416',
      repo: 'blackcat-darkmesh-gateway',
      workflow: 'ci.yml',
      ref: 'main',
      inputs: {
        consistency_urls: 'https://gw-a.example,https://gw-b.example',
        consistency_token: 'secret-cons',
        evidence_urls: 'https://ev-a.example',
        evidence_token: 'secret-ev',
      },
      token: 'ghp_secret-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(204)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, request] = fetchSpy.mock.calls[0] as [
      URL,
      {
        method: string
        headers: Record<string, string>
        body: string
      },
    ]
    expect(url.toString()).toBe(
      'https://api.github.com/repos/Vito416/blackcat-darkmesh-gateway/actions/workflows/ci.yml/dispatches',
    )
    expect(request.method).toBe('POST')
    expect(request.headers.accept).toBe('application/vnd.github+json')
    expect(request.headers.authorization).toBe('Bearer ghp_secret-token')
    expect(JSON.parse(request.body)).toEqual({
      ref: 'main',
      inputs: {
        consistency_urls: 'https://gw-a.example,https://gw-b.example',
        consistency_token: 'secret-cons',
        evidence_urls: 'https://ev-a.example',
        evidence_token: 'secret-ev',
      },
    })
  })

  it('supports dry-run dispatches without calling fetch', async () => {
    const fetchSpy = vi.fn()

    const result = await dispatchWorkflow({
      owner: 'Vito416',
      repo: 'blackcat-darkmesh-gateway',
      workflow: 'ci.yml',
      ref: 'release/1.2.1',
      inputs: {
        consistency_urls: 'https://gw-a.example',
      },
      token: '',
      dryRun: true,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    expect(result.dryRun).toBe(true)
    expect(result.endpoint).toBe(
      'https://api.github.com/repos/Vito416/blackcat-darkmesh-gateway/actions/workflows/ci.yml/dispatches',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns usage errors and dry-run success codes via the CLI runner', async () => {
    await expect(
      runCli(['--owner', 'Vito416', '--repo', 'blackcat-darkmesh-gateway', '--dry-run'], { GITHUB_REF_NAME: 'main' }, vi.fn()),
    ).resolves.toBe(0)

    await expect(
      runCli(['--owner', 'Vito416', '--repo', 'blackcat-darkmesh-gateway'], { GITHUB_REF_NAME: 'main' }, vi.fn()),
    ).resolves.toBe(64)
  })
})
