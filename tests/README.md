# Tests (skeleton)

- Unit: manifest verification, cache TTL/wipe, PSP signature check.
- Integrity parity: `tests/integrity-client.test.ts`, `tests/integrity-verifier.test.ts`, `tests/integrity-parity.test.ts`, and `tests/integrity-cache-enforcement.test.ts` cover paused-mode semantics, missing trusted root classification, integrity mismatch classification, verified-cache fail-closed behavior, and AO codec-envelope snapshot parsing.
- Integrity policy gate: `tests/integrity-policy-gate.test.ts` covers env fallback, malformed policy JSON fallback, AO snapshot pause state, and checkpoint restore behavior when AO fetch fails.
- Integration: checkout flow with fake PSP/webhooks, cache wipe on ForgetSubject.
- Load: cache hit/miss under concurrency.

Run the integrity suite directly:

```bash
npm test -- --run tests/integrity-*.test.ts
```

Suggested stack: Vitest/Jest + supertest (if using Node/TS), or wrangler test if targeting Workers runtime.
