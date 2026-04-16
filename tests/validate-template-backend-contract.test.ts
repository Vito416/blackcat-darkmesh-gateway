import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('../scripts/validate-template-backend-contract.js', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function buildContract(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0',
    templateId: 'gateway-default',
    templateVersion: '1.0.0',
    allowedActions: [
      {
        name: 'public.resolve-route',
        method: 'POST',
        path: '/api/public/resolve-route',
      },
      {
        name: 'public.get-page',
        method: 'POST',
        path: '/api/public/page',
      },
    ],
    forbiddenCapabilities: ['raw-sql', 'arbitrary-outbound-http', 'eval', 'secret-access'],
    ...overrides,
  }
}

function writeContractFile(contract: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-contract-'))
  tempDirs.push(dir)
  const file = join(dir, 'template-backend-contract.json')
  writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
  return file
}

function runValidator(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  })
}

describe('validate-template-backend-contract.js', () => {
  it('accepts a valid contract', () => {
    const file = writeContractFile(buildContract())
    const res = runValidator(['--file', file])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Template backend contract passed')
    expect(res.stdout).toContain(`File: ${file}`)
    expect(res.stderr).toBe('')
  })

  it('reports duplicate action names without failing non-strict validation', () => {
    const file = writeContractFile(
      buildContract({
        allowedActions: [
          {
            name: 'checkout.create-order',
            method: 'POST',
            path: '/api/checkout/order',
          },
          {
            name: 'checkout.create-order',
            method: 'POST',
            path: '/api/checkout/payment-intent',
          },
        ],
      }),
    )

    const res = runValidator(['--file', file])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('allowedActions[1].name must be unique')
    expect(res.stderr).toBe('')
  })

  it('reports duplicate routes without failing non-strict validation', () => {
    const file = writeContractFile(
      buildContract({
        allowedActions: [
          {
            name: 'checkout.create-order',
            method: 'POST',
            path: '/api/checkout/order',
          },
          {
            name: 'checkout.replay-order',
            method: 'POST',
            path: '/api/checkout/order',
          },
        ],
      }),
    )

    const res = runValidator(['--file', file])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('duplicates route POST /api/checkout/order')
    expect(res.stderr).toBe('')
  })

  it('reports missing schema refs when declared by contract actions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-contract-'))
    tempDirs.push(dir)

    mkdirSync(join(dir, 'schemas', 'template'), { recursive: true })
    writeFileSync(join(dir, 'schemas', 'template', 'present.response.json'), '{}\n', 'utf8')

    const file = join(dir, 'template-backend-contract.json')
    writeFileSync(
      file,
      `${JSON.stringify(
        buildContract({
          allowedActions: [
            {
              name: 'public.resolve-route',
              method: 'POST',
              path: '/api/public/resolve-route',
              requestSchemaRef: 'schemas/template/missing.request.json',
              responseSchemaRef: 'schemas/template/present.response.json',
            },
          ],
        }),
        null,
        2,
      )}\n`,
      'utf8',
    )

    const res = runValidator(['--file', file, '--strict'])
    expect(res.status).toBe(3)
    expect(res.stdout).toContain('requestSchemaRef file not found')
    expect(res.stderr).toBe('')
  })

  it('returns a usage error when --file is missing a value', () => {
    const res = runValidator(['--file'])
    expect(res.status).toBe(64)
    expect(res.stderr).toContain('error: missing value for --file')
    expect(res.stdout).toContain('Usage:')
  })
})
