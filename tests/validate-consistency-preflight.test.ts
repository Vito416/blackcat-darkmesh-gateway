import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/validate-consistency-preflight.js', import.meta.url))

function runCli(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('validate-consistency-preflight.js', () => {
  afterEach(() => {
    delete process.env.CONSISTENCY_URLS
  })

  it('passes with a valid preflight configuration', () => {
    const res = runCli([
      '--urls',
      'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
      '--token',
      'shared-token',
    ])

    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Consistency preflight passed')
    expect(res.stdout).toContain('Mode: pairwise')
    expect(res.stdout).toContain('Profile: wedos_medium')
    expect(res.stdout).toContain('Auth: token provided')
    expect(res.stderr).toBe('')
  })

  it('rejects malformed preflight config with exit code 3', () => {
    const cases = [
      {
        name: 'not enough urls',
        args: ['--urls', 'https://gw-a.example/integrity/state', '--token', 'shared-token'],
        message: '--urls must contain at least two valid http(s) URLs',
      },
      {
        name: 'invalid url scheme',
        args: [
          '--urls',
          'https://gw-a.example/integrity/state,ftp://gw-b.example/integrity/state',
          '--token',
          'shared-token',
        ],
        message: '--urls[2] must use http(s): ftp://gw-b.example/integrity/state',
      },
      {
        name: 'invalid mode',
        args: [
          '--urls',
          'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
          '--mode',
          'sideways',
          '--token',
          'shared-token',
        ],
        message: 'unsupported --mode value: sideways',
      },
      {
        name: 'invalid profile',
        args: [
          '--urls',
          'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
          '--profile',
          'tiny',
          '--token',
          'shared-token',
        ],
        message: 'unsupported --profile value: tiny',
      },
      {
        name: 'missing token without allow-anon',
        args: [
          '--urls',
          'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
        ],
        message: '--token is required unless --allow-anon is set',
      },
    ]

    for (const testCase of cases) {
      const res = runCli(testCase.args)
      expect(res.status, testCase.name).toBe(3)
      expect(res.stdout, testCase.name).toContain('Consistency preflight failed')
      expect(res.stderr, testCase.name).toBe('')
      expect(res.stdout, testCase.name).toContain(testCase.message)
    }
  })

  it('returns usage error when required args are missing', () => {
    const res = runCli(['--token', 'shared-token'])
    expect(res.status).toBe(64)
    expect(res.stderr).toContain('error: --urls is required')
    expect(res.stdout).toContain('Usage:')
  })

  it('prints structured JSON only with --json', () => {
    const res = runCli([
      '--urls',
      'https://gw-a.example/integrity/state,https://gw-b.example/integrity/state',
      '--allow-anon',
      '--json',
    ])

    expect(res.status).toBe(0)
    expect(() => JSON.parse(res.stdout)).not.toThrow()

    const parsed = JSON.parse(res.stdout)
    expect(parsed).toMatchObject({
      ok: true,
      exitCode: 0,
      mode: 'pairwise',
      profile: 'wedos_medium',
      allowAnon: true,
      tokenPresent: false,
      urls: [
        'https://gw-a.example/integrity/state',
        'https://gw-b.example/integrity/state',
      ],
    })
    expect(res.stdout.trim().startsWith('{')).toBe(true)
    expect(res.stdout).not.toContain('Consistency preflight passed')
  })
})
