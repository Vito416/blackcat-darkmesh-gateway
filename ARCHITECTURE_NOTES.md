# Gateway notes – immutable assets + manifest

Goal: keep gateway lightweight by serving only immutable assets (Arweave) plus a small per-page manifest.

## Responsibilities
- Fetch manifest (TxID) → fetch referenced assets (layouts/themes/components/data) → serve to client.
- Prefer local cache/pinning; fallback to multiple Arweave gateways.
- Expose CSP headers to restrict scripts/styles to allowed Arweave origins + hashes.
- Optional allowlist: reject manifests that reference assets outside curated allowlist TxIDs.

## Concrete fetch + pin flow
1) Resolve manifest TxID from the request path or routing table.
2) Choose gateway order from config (e.g., `[local-cache → arweave.net → ar-io → goldsky]`) and apply most-recently-healthy weighting.
3) Try local cache first:
   - If manifest is cached and still valid (JSON parseable + passes allowlist + signature), use it.
   - Otherwise continue to remote fetch.
4) Fetch manifest JSON from the first healthy gateway with `Accept: application/json`, timeout per gateway (e.g., 2–3s), and small retry (1–2 attempts) before moving to the next gateway.
5) Validate manifest:
   - Size bounds (e.g., <1 MB) and required fields.
   - Optional signature/hash verification (ed25519 + public key from config).
   - Apply allowlist validation (see below).
6) For each asset TxID in the manifest:
   - Check local pin/cache; if present, mark as hit.
   - Otherwise fetch in parallel with bounded concurrency (e.g., 8–16 inflight) using the multi-gateway fallback algorithm below; stream to disk and mark as pinned on success.
   - Record which gateway served the asset for metrics.
7) Build response:
   - Add `Link: </tx/{id}>; rel=preload; as=script|style|fetch` hints for entry assets.
   - Compute ETag/Last-Modified from the manifest TxID for the HTML shell.
8) Serve the minimal HTML shell that boots the client bundle and injects the manifest (or manifest URL), plus CSP headers.
9) Background: keep a small LRU pin-set for popular assets; evict least-used when above disk budget.

## Caching
- Immutable assets: cache “forever”; key by TxID.
- Manifest: short TTL but immutable (TxID) → safe to cache; can still re-validate to refresh allowlist/signature.
- Consider local pin set for most-used assets.

## Security
- CSP header template (tighten per deploy):
  - `Content-Security-Policy: default-src 'none'; base-uri 'none'; script-src 'self' https://arweave.net https://*.arweave.dev 'sha256-<entry-hash>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://arweave.net https://*.arweave.dev; font-src 'self' https://arweave.net https://*.arweave.dev; connect-src 'self' https://arweave.net https://*.arweave.dev; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests`
  - Replace `<entry-hash>` with the SRI of the boot script emitted at build time; trim gateway list to the configured set.
  - Add `report-uri` / `report-to` endpoints if available to collect CSP violations.
- Allowlist validation (per manifest):
  1) Load the curated allowlist (TxIDs or prefixes) from config/cache; refresh on a separate interval.
  2) Reject if manifest TxID itself is not allowlisted when “strict” mode is enabled.
  3) For each asset record, reject if the TxID is absent from the allowlist for its declared type/scope.
  4) Enforce max asset count and max total manifest size to avoid abuse.
  5) Emit structured audit logs for rejects (TxID, reason, requester) and surface metric counters.
- Optional: verify manifest signature (ed25519) before serving.

## Fallback / resilience
- Multi-gateway fetch algorithm (per TxID):
  - Maintain rolling gateway health scores (p50/p95 latency, error rate, last failure time).
  - Order gateways by score; attempt fetch with short timeout and single retry per gateway.
  - On failure, increment backoff for that gateway and proceed to the next; mark failing gateways as “degraded” for a cool-off window.
  - If all gateways fail but asset is pinned locally, serve from pin; otherwise surface 502 with context for observability.
  - Periodically probe degraded gateways with lightweight HEAD to restore them to the pool.
- Health-check/prefetch: periodically HEAD/GET the top-N assets and manifests; refresh pins that are near eviction.

## Logging/metrics
- Availability
  - Gateway health: latency p50/p95, timeout/error rate per upstream; current active order.
  - Fallback usage: count of multi-gateway step-downs per TxID.
- Content integrity
  - Manifest validation rejects (signature/allowlist/schema/size) with reasons.
  - CSP violation reports grouped by blocked-uri and directive.
- Performance
  - Cache hit/miss per asset type; pin eviction rate; pin fill time.
  - Fetch latency split: manifest vs. assets; bytes served by cache vs. network.
- Resource health
  - Disk usage of pin/cache; file descriptor pool; fetch queue depth; concurrency saturation.
- Ops checks
  - Liveness: process up, can serve from cache.
  - Readiness: can reach at least one healthy gateway and read pin store.
  - Alerting thresholds: error rate spikes, CSP violation bursts, allowlist reject rate, sustained fallback to last gateway.
