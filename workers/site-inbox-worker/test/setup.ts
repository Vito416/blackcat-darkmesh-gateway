import { afterAll, vi } from 'vitest'
import { webcrypto } from 'crypto'

// Ensure miniflare processes shut down cleanly
afterAll(async () => {
  // noop hook if we need future cleanup
})

vi.setConfig({
  testTimeout: 30000,
  pool: 'forks',
  maxThreads: 1,
})

// Ensure Web Crypto available for HMAC/digest in tests
if (!(globalThis as any).crypto) {
  ;(globalThis as any).crypto = webcrypto as any
}
