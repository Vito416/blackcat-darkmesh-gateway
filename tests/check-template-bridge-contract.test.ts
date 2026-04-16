import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { runCli } from '../scripts/check-template-bridge-contract.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeFile(root: string, relPath: string, text: string) {
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

function buildWorkspace(
  options: { workerPageRoute?: boolean; writePaymentRoute?: boolean; writePackageVersion?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'gateway-bridge-contract-'))
  tempDirs.push(root)

  writeFile(
    root,
    'blackcat-darkmesh-gateway/config/template-backend-contract.json',
    JSON.stringify(
      {
        schemaVersion: '1.1.0',
        templateId: 'gateway-default',
        templateVersion: '1.1.0',
        allowedActions: [
          {
            name: 'public.resolve-route',
            method: 'POST',
            path: '/api/public/resolve-route',
          },
          {
            name: 'public.site-by-host',
            method: 'POST',
            path: '/api/public/site-by-host',
          },
          {
            name: 'public.get-page',
            method: 'POST',
            path: '/api/public/page',
          },
          {
            name: 'checkout.create-order',
            method: 'POST',
            path: '/api/checkout/order',
          },
          {
            name: 'checkout.create-payment-intent',
            method: 'POST',
            path: '/api/checkout/payment-intent',
          },
        ],
      },
      null,
      2,
    ),
  )

  writeFile(
    root,
    'blackcat-darkmesh-gateway/src/runtime/template/actions.ts',
    [
      "export const templateActionPolicies = [",
      "  { action: 'public.resolve-route', kind: 'read', target: 'ao', path: '/api/public/resolve-route', method: 'POST' },",
      "  { action: 'public.site-by-host', kind: 'read', target: 'ao', path: '/api/public/site-by-host', method: 'POST' },",
      `  { action: 'public.get-page', kind: 'read', target: 'ao', path: '${options.workerPageRoute ? '/api/public/page-v2' : '/api/public/page'}', method: 'POST' },`,
      "  { action: 'checkout.create-order', kind: 'write', target: 'write', path: '/api/checkout/order', method: 'POST' },",
      "  { action: 'checkout.create-payment-intent', kind: 'write', target: 'write', path: '/api/checkout/payment-intent', method: 'POST' },",
      ']',
      '',
    ].join('\n'),
  )

  writeFile(root, 'blackcat-darkmesh-ao/package.json', JSON.stringify({ version: '1.2.0' }, null, 2))
  writeFile(
    root,
    'blackcat-darkmesh-write/package.json',
    JSON.stringify({ version: options.writePackageVersion || '1.0.0' }, null, 2),
  )

  writeFile(
    root,
    'blackcat-darkmesh-ao/scripts/http/public_api_server.mjs',
    [
      "app.post('/api/public/resolve-route', async () => {})",
      "app.post('/api/public/site-by-host', async () => {})",
      options.workerPageRoute ? '' : "app.post('/api/public/page', async () => {})",
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  writeFile(
    root,
    'blackcat-darkmesh-write/scripts/http/checkout_api_server.mjs',
    [
      "if (pathname === '/api/checkout/order') return 'ok'",
      `if (pathname === '${options.writePaymentRoute === false ? '/api/checkout/payment-intent-v2' : '/api/checkout/payment-intent'}') return 'ok'`,
      '',
    ].join('\n'),
  )

  return root
}

describe('check-template-bridge-contract.js', () => {
  it('passes when the bridge contract, gateway routes, and adapters are aligned', () => {
    const root = buildWorkspace()
    const res = runCli(['--workspace-root', root, '--strict', '--json'])

    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.status).toBe('pass')
    expect(parsed.issueCount).toBe(0)
    expect(parsed.contractVersion.templateVersion).toBe('1.1.0')
    expect(res.stderr).toBe('')
  })

  it('flags version and route drift with actionable diagnostics', () => {
    const root = buildWorkspace({ workerPageRoute: true, writePaymentRoute: false, writePackageVersion: '2.0.0' })

    const res = runCli(['--workspace-root', root, '--strict'])
    expect(res.exitCode).toBe(3)
    expect(res.stdout).toContain('Template bridge contract issues found')
    expect(res.stdout).toContain('gateway runtime action public.get-page uses path /api/public/page-v2')
    expect(res.stdout).toContain('AO public API adapter is missing /api/public/page')
    expect(res.stdout).toContain('write checkout adapter is missing /api/checkout/payment-intent')
    expect(res.stdout).toContain('blackcat-darkmesh-write/package.json major 2 does not match bridge templateVersion major 1')
    expect(res.stderr).toBe('')
  })
})
