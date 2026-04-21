import { describe, expect, it } from 'vitest'
import app from '../src/index.js'

describe('edge routing worker', () => {
  it('returns health', async () => {
    const res = await app.request('http://example.test/health', {}, { HB_TARGETS: '' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
