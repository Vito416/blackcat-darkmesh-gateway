# Edge Routing Worker (scaffold)

Purpose: lightweight ingress router that keeps user-visible domain intact while selecting an appropriate HyperBEAM upstream.

## Scope

- Accept request by host/domain.
- Optionally resolve host->site via AO/public resolver.
- Pick upstream HyperBEAM target from configured pool.
- Forward request with strict headers and fail-closed checks.

## Non-goals

- No PIP persistence.
- No signing private keys.
- No template rendering logic.

## Quick start

1. `cp wrangler.toml.example wrangler.toml`
2. Fill `HB_TARGETS` and optional `AO_SITE_RESOLVE_URL`.
3. `npm install`
4. `npm run dev`

## Security baseline

- Unknown hosts return `404` by default.
- Host allow decision should come from AO resolver or signed static map.
- Upstream target chosen from strict allowlist only.
