import { describe, it, expect } from 'vitest'
import mod from '../src/index'

const env = {
  TEST_IN_MEMORY_KV: 1,
  INBOX_HMAC_SECRET: 'stress-secret',
  INBOX_HMAC_OPTIONAL: '1',
  AUTH_REQUIRE_SIGNATURE: '0',
  AUTH_REQUIRE_NONCE: '0',
  FORGET_TOKEN: 'test-token',
}

describe('stress smoke', () => {
  it('handles concurrent inbox puts', { timeout: 10000 }, async () => {
    const reqs = Array.from({ length: 50 }).map((_, i) =>
      mod.fetch(
        new Request('http://worker/inbox', {
          method: 'POST',
          body: JSON.stringify({ nonce: `n${i}`, subject: 'stress', payload: 'x' }),
          headers: { 'content-type': 'application/json' },
        }),
        env as any,
        {} as any,
      ),
    )
    const res = await Promise.all(reqs)
    res.forEach((r) => expect([200, 201]).toContain(r.status))
  })
})
