# AO worker migration verification (2026-04-23)

Date: 2026-04-23  
Status: verified  
Scope: legacy AO worker folder -> `blackcat-darkmesh-gateway/workers/secrets-worker`

## Result

The AO worker runtime is fully migrated into gateway worker scope and extended for two-worker protocol needs.

- No files were found that existed only in the legacy AO worker folder and were missing in `workers/secrets-worker`.
- Gateway copy contains additive features (route assertion issue/verify/replay modules + tests).

## Evidence

### Directory-level diff

Command used:

```bash
diff -qr \
  --exclude node_modules \
  --exclude package-lock.json \
  --exclude wrangler.toml \
  --exclude .wrangler \
  --exclude dist \
  <legacy_ao_worker_dir> \
  blackcat-darkmesh-gateway/workers/secrets-worker
```

Observed differences:

- modified in gateway copy:
  - `README.md`
  - `src/index.ts`
  - `src/types.d.ts`
- added in gateway copy:
  - `src/routeAssertion.ts`
  - `src/routeAssertionVerify.ts`
  - `src/routeAssertionReplay.ts`
  - tests:
    - `test/route-assert.test.ts`
    - `test/route-assert-verify.test.ts`
    - `test/route-assert-verify-replay.test.ts`

No "Only in <legacy_ao_worker_dir>" entries were reported.

### Test parity check

Historical AO worker tests (before retirement):

- Result snapshot (captured before removing the AO-local worker folder): 11 files, 67 tests passed.

Gateway Secrets Worker tests:

```bash
cd blackcat-darkmesh-gateway/workers/secrets-worker && npm test
```

- Result: 14 files, 80 tests passed.

Interpretation:

- Base AO runtime behavior is preserved.
- Gateway version adds assertion/security domain-control features on top.

## Naming and runtime note

Current canonical worker folders:

- `secrets-worker` (operational role: Secrets Worker)
- `async-worker` (operational role: Async Worker)

Legacy edge worker runtime was removed; primary runtime is strictly the two-worker model.
