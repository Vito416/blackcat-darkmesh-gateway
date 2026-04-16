import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTemplateContractAction, resetTemplateContractCacheForTests } from '../src/templateContract.js'

const originalEnv = { ...process.env }
const tempDirs: string[] = []

beforeEach(() => {
  process.env = { ...originalEnv }
  resetTemplateContractCacheForTests()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetTemplateContractCacheForTests()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeContractFile(contract: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-template-contract-'))
  tempDirs.push(dir)
  const file = join(dir, 'template-backend-contract.json')
  writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
  return file
}

describe('template contract loader', () => {
  it('uses the repository default contract when the file env is unset', () => {
    delete process.env.GATEWAY_TEMPLATE_CONTRACT_FILE

    const action = getTemplateContractAction('public.resolve-route')

    expect(action?.path).toBe('/api/public/resolve-route')
    expect(action?.auth.requiredRole).toBe('public')
  })

  it('loads a configured contract file and caches per path', () => {
    const file = writeContractFile({
      schemaVersion: '1.0.0',
      templateId: 'test-template',
      templateVersion: '1.0.0',
      allowedActions: [
        {
          name: 'custom.action',
          method: 'POST',
          path: '/api/custom/action',
          auth: { requiredRole: 'public' },
          requestSchemaRef: 'schema.request.json',
          responseSchemaRef: 'schema.response.json',
          ratelimitProfile: 'template_public_read',
          idempotency: { mode: 'optional' },
        },
      ],
    })

    process.env.GATEWAY_TEMPLATE_CONTRACT_FILE = file

    const action = getTemplateContractAction('custom.action')

    expect(action?.path).toBe('/api/custom/action')
    expect(action?.idempotency).toEqual({ mode: 'optional' })
  })

  it('returns null when the configured contract file is missing', () => {
    process.env.GATEWAY_TEMPLATE_CONTRACT_FILE = '/tmp/does-not-exist-template-contract.json'

    expect(getTemplateContractAction('public.resolve-route')).toBeNull()
  })
})
