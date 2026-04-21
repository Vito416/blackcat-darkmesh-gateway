import { describe, expect, it } from 'vitest'
import app from '../src/index.js'

describe('site mailer worker', () => {
  it('returns health', async () => {
    const res = await app.request('http://example.test/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
