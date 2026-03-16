# Tests (skeleton)

- Unit: manifest verification, cache TTL/wipe, PSP signature check.
- Integration: checkout flow with fake PSP/webhooks, cache wipe on ForgetSubject.
- Load: cache hit/miss under concurrency.

Suggested stack: Vitest/Jest + supertest (if using Node/TS), or wrangler test if targeting Workers runtime.
