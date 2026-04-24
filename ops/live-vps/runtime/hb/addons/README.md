# HyperBEAM addon references

This folder contains **reference implementation artifacts** for the resolver alias path (`~darkmesh-resolver@1.0`).

Current file:

- `darkmesh-resolver@1.0.lua` – AO resolver process implementation candidate used for team review/upstream proposal.
  - module dependencies: `ao.shared.codec`, `ao.shared.validation`, `ao.shared.auth`, `ao.shared.idempotency`, `ao.shared.metrics`, `ao.shared.persist`
- `fixtures/resolver-fixtures.v1.lua` – fixture matrix for resolver safety regressions.

Important boundary:

- HyperBEAM runtime remains stock.
- The resolver process is AO-side logic.
- HyperBEAM only needs the alias route in `entrypoint.sh` + PID file (`/srv/darkmesh/hb/data/darkmesh-resolver.pid`).

How to use this file:

1. Treat it as source-of-truth proposal for AO team review.
2. Deploy resolver process through your AO/write flow.
3. Write resulting resolver PID into `/srv/darkmesh/hb/data/darkmesh-resolver.pid`.
4. Restart HyperBEAM container only when alias route PID changes.

Related implementation pack:

- `ops/migrations/DARKMESH_RESOLVER_V1_IMPLEMENTATION_PACK_2026-04-24.md`

Local validation:

- `npm run ops:validate-resolver-fixtures`
- `npm run ops:validate-resolver-pack`
