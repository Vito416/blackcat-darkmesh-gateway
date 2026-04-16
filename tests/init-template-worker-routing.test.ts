import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { assessTemplateWorkerRoutingScaffold } from '../scripts/init-template-worker-routing.js'

const scriptPath = fileURLToPath(new URL('../scripts/init-template-worker-routing.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-template-worker-routing-'))
  tempDirs.push(dir)
  return dir
}

function runScript(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('init-template-worker-routing.js', () => {
  it('generates url and token maps', () => {
    const dir = makeTempDir()
    const urlMapOut = join(dir, 'url-map.json')
    const tokenMapOut = join(dir, 'token-map.json')

    const res = runScript([
      '--sites',
      'alpha,beta',
      '--url-map-out',
      urlMapOut,
      '--token-map-out',
      tokenMapOut,
    ])

    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'complete',
      siteCount: 2,
      urlMapPath: urlMapOut,
      tokenMapPath: tokenMapOut,
    })

    expect(JSON.parse(readFileSync(urlMapOut, 'utf8'))).toEqual({
      alpha: 'https://worker-alpha.example.invalid',
      beta: 'https://worker-beta.example.invalid',
    })
    expect(JSON.parse(readFileSync(tokenMapOut, 'utf8'))).toEqual({
      alpha: 'replace-with-token-for-alpha',
      beta: 'replace-with-token-for-beta',
    })
  })

  it('refuses overwrite without force', () => {
    const dir = makeTempDir()
    const urlMapOut = join(dir, 'url-map.json')
    const tokenMapOut = join(dir, 'token-map.json')

    writeFileSync(urlMapOut, '{"existing":true}\n', 'utf8')
    writeFileSync(tokenMapOut, '{"existing":true}\n', 'utf8')

    const res = runScript([
      '--sites',
      'alpha',
      '--url-map-out',
      urlMapOut,
      '--token-map-out',
      tokenMapOut,
    ])

    expect(res.status).toBe(3)
    expect(res.stderr).toContain('refusing to overwrite existing file')
    expect(JSON.parse(readFileSync(urlMapOut, 'utf8'))).toEqual({ existing: true })
    expect(JSON.parse(readFileSync(tokenMapOut, 'utf8'))).toEqual({ existing: true })
  })

  it('allows overwrite with force', () => {
    const dir = makeTempDir()
    const urlMapOut = join(dir, 'url-map.json')
    const tokenMapOut = join(dir, 'token-map.json')

    writeFileSync(urlMapOut, '{"existing":true}\n', 'utf8')
    writeFileSync(tokenMapOut, '{"existing":true}\n', 'utf8')

    const res = runScript([
      '--sites',
      'alpha',
      '--url-map-out',
      urlMapOut,
      '--token-map-out',
      tokenMapOut,
      '--force',
    ])

    expect(res.status).toBe(0)
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'complete',
      siteCount: 1,
    })
    expect(JSON.parse(readFileSync(urlMapOut, 'utf8'))).toEqual({
      alpha: 'https://worker-alpha.example.invalid',
    })
    expect(JSON.parse(readFileSync(tokenMapOut, 'utf8'))).toEqual({
      alpha: 'replace-with-token-for-alpha',
    })
  })

  it('returns usage error when sites are missing or blank', () => {
    const missing = runScript([])
    expect(missing.status).toBe(64)
    expect(missing.stderr).toContain('--sites is required')

    const blank = runScript(['--sites', '   '])
    expect(blank.status).toBe(64)
    expect(blank.stderr).toContain('--sites is required')
  })

  it('exposes the pure scaffold helper', () => {
    const dir = makeTempDir()
    const urlMapOut = join(dir, 'url-map.json')
    const tokenMapOut = join(dir, 'token-map.json')

    const result = assessTemplateWorkerRoutingScaffold({
      sitesRaw: 'alpha,beta',
      urlMapOut,
      tokenMapOut,
      force: true,
    })

    expect(result.siteCount).toBe(2)
    expect(result.urlMapPath).toBe(urlMapOut)
    expect(result.tokenMapPath).toBe(tokenMapOut)
    expect(existsSync(urlMapOut)).toBe(true)
    expect(existsSync(tokenMapOut)).toBe(true)
  })
})
