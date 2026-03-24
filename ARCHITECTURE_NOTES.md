# Gateway notes – immutable assets + manifest

Goal: keep gateway lightweight by serving only immutable assets (Arweave) plus a small per-page manifest.

## Responsibilities
- Fetch manifest (TxID) → fetch referenced assets (layouts/themes/components/data) → serve to client.
- Prefer local cache/pinning; fallback to multiple Arweave gateways.
- Expose CSP headers to restrict scripts/styles to allowed Arweave origins + hashes.
- Optional allowlist: reject manifests that reference assets outside curated allowlist TxIDs.

## Fetch flow (suggested)
1) Receive request for page: identify manifest TxID.
2) Fetch manifest JSON; verify signature/checksum if present.
3) For each asset Tx in manifest: fetch/pin; build response hints (preload links).
4) Serve entry HTML that loads the entry bundle and passes manifest (or manifest URL) to client.

## Caching
- Immutable assets: cache “forever”; key by TxID.
- Manifest: short TTL but immutable (TxID) → safe to cache; can still re-validate to refresh allowlist/signature.
- Consider local pin set for most-used assets.

## Security
- CSP: `script-src 'self' https://arweave.net https://*.arweave.dev` + hashes for entry bundle; `connect-src` to chosen gateways.
- Validate manifest against allowlist of asset TxIDs (curated collection).
- Optional: verify manifest signature (ed25519) before serving.

## Fallback / resilience
- Multiple gateways: arweave.net, ar-io mirrors, Goldsky; try in order, then serve cached.
- Health-check/prefetch popular assets.

## Logging/metrics
- Cache hit/miss per asset type.
- Manifest validation failures (signature/allowlist).
- Gateway latency (manifest fetch vs. asset fetch).

