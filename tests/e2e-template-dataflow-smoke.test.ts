import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runTemplateDataflowSmoke } from '../scripts/e2e-template-dataflow-smoke.js'
import { handleRequest } from '../src/handler.js'
import { resetTemplateContractCacheForTests } from '../src/templateContract.js'

describe('template dataflow e2e smoke', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetTemplateContractCacheForTests()
  })

  it('validates read/write request shaping with local mocked upstreams', async () => {
    const result = await runTemplateDataflowSmoke({ handleRequest })

    expect(result.ok).toBe(true)
    expect(result.read.upstreamPath).toBe('/api/public/resolve-route')
    expect(result.read.requestId).toBe('smoke-read-req-1')
    expect(result.write.signerPath).toBe('/sign')
    expect(result.write.upstreamPath).toBe('/api/checkout/order')
    expect(result.write.requestId).toBe('smoke-write-req-1')
    expect(result.write.signatureRef).toBe('worker-smoke-ref')
  })
})
