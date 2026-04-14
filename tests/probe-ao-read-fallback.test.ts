import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../scripts/probe-ao-read-fallback.js'

function withServer(responder: (path: string) => { status: number; body: Record<string, unknown> }) {
  return new Promise<{
    baseUrl: string
    close: () => Promise<void>
  }>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const path = (req.url || '').split('?')[0]
      const out = responder(path)
      res.writeHead(out.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out.body))
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('invalid_server_address')))
        return
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

describe('probe-ao-read-fallback.js', () => {
  it('passes and exports evidence when dryrun/scheduler transport modes are visible', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ao-fallback-probe-pass-'))
    const dryrun = await withServer((path) => {
      if (path === '/api/public/resolve-route') {
        return { status: 200, body: { status: 'OK', transport: { mode: 'dryrun' } } }
      }
      if (path === '/api/public/page') {
        return { status: 200, body: { status: 'OK', transport: { mode: 'dryrun' } } }
      }
      return { status: 404, body: { status: 'ERROR', code: 'NOT_FOUND' } }
    })
    const scheduler = await withServer((path) => {
      if (path === '/api/public/resolve-route') {
        return { status: 200, body: { status: 'OK', transport: { mode: 'scheduler' } } }
      }
      if (path === '/api/public/page') {
        return { status: 200, body: { status: 'OK', transport: { mode: 'scheduler-direct' } } }
      }
      return { status: 404, body: { status: 'ERROR', code: 'NOT_FOUND' } }
    })

    try {
      const result = await runCli([
        '--dryrun-base',
        dryrun.baseUrl,
        '--scheduler-base',
        scheduler.baseUrl,
        '--site-id',
        'site-alpha',
        '--out-dir',
        outDir,
        '--prefix',
        'probe-pass',
        '--json',
        '--strict',
      ])

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.status).toBe('pass')
      expect(parsed.counts.issueCount).toBe(0)
      expect(parsed.counts.warningCount).toBe(0)

      const jsonEvidence = JSON.parse(readFileSync(join(outDir, 'probe-pass.json'), 'utf8'))
      expect(jsonEvidence.status).toBe('pass')
      expect(jsonEvidence.probes).toHaveLength(4)
      const mdEvidence = readFileSync(join(outDir, 'probe-pass.md'), 'utf8')
      expect(mdEvidence).toContain('# AO Read Fallback Chaos Probe')
    } finally {
      await Promise.all([dryrun.close(), scheduler.close()])
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('returns pending when transport modes are missing and strict mode fails', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ao-fallback-probe-pending-'))
    const dryrun = await withServer((path) => {
      if (path === '/api/public/resolve-route' || path === '/api/public/page') {
        return { status: 200, body: { status: 'OK' } }
      }
      return { status: 404, body: { status: 'ERROR', code: 'NOT_FOUND' } }
    })
    const scheduler = await withServer((path) => {
      if (path === '/api/public/resolve-route' || path === '/api/public/page') {
        return { status: 200, body: { status: 'OK' } }
      }
      return { status: 404, body: { status: 'ERROR', code: 'NOT_FOUND' } }
    })

    try {
      const nonStrict = await runCli([
        '--dryrun-base',
        dryrun.baseUrl,
        '--scheduler-base',
        scheduler.baseUrl,
        '--site-id',
        'site-alpha',
        '--out-dir',
        outDir,
        '--prefix',
        'probe-pending',
        '--json',
      ])
      expect(nonStrict.exitCode).toBe(0)
      expect(JSON.parse(nonStrict.stdout).status).toBe('pending')

      const strict = await runCli([
        '--dryrun-base',
        dryrun.baseUrl,
        '--scheduler-base',
        scheduler.baseUrl,
        '--site-id',
        'site-alpha',
        '--out-dir',
        outDir,
        '--prefix',
        'probe-pending-strict',
        '--json',
        '--strict',
      ])
      expect(strict.exitCode).toBe(3)
      expect(JSON.parse(strict.stdout).status).toBe('pending')
    } finally {
      await Promise.all([dryrun.close(), scheduler.close()])
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
