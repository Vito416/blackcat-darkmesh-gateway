# Worker Secrets Trust Model

This document formalizes the boundary for the gateway/template/worker split.

## Invariant

- Templates are public and verifiable.
- Gateway is universal and public-serving.
- Secrets live only in the per-site worker.
- Gateway may route, validate, cache, and proxy public or encrypted data, but it must not own site secrets.

## Component roles

- `blackcat-templates`: public template bundles, manifests, hashes, and other verifiable assets.
- `blackcat-darkmesh-gateway`: public edge, request router, integrity gate, and policy enforcement point.
- Per-site worker: secret holder for PSP keys, SMTP credentials, OTP secrets, and other site-specific private material.

## Allowed data flow

- Browser -> Gateway -> public template bundle / public AO state.
- Browser -> Gateway -> validated action request that contains no secrets.
- Gateway -> Worker -> secret-dependent operation, with the worker holding the secret material.
- Worker -> Gateway -> bounded response or signed result needed to finish a public flow.
- Gateway -> AO/Write -> public or pseudonymous state only.

## Forbidden data flow

- Templates reading worker secrets directly.
- Gateway persisting plaintext secrets, long-lived secret copies, or secret caches.
- Public template bundles embedding per-site secrets.
- Browser or template code bypassing gateway policy to reach worker internals.
- AO/Write receiving raw worker secrets instead of hashes, refs, or public results.

## Boundary checks

- Templates must be verified against a trusted manifest or equivalent signed/public proof before serving.
- Gateway request handlers must reject any payload that tries to smuggle worker-secret fields.
- Worker-facing calls must be explicit, site-scoped, and authenticated.
- Secret-bearing values must stay on the worker side unless they are transformed into a public-safe result.
- Any cache in gateway must be TTL-bounded and treat encrypted envelopes as opaque; secrets themselves never enter the cache.

## Operational rules

- If a flow needs a secret, the worker owns the secret and performs the secret-dependent step.
- If a flow is public, keep it in templates, AO read state, or gateway policy checks.
- If a flow mixes public and secret data, split it so the gateway only sees the public envelope and the worker only sees the secret dependency.
- Rotate worker secrets per site; do not use gateway-wide secret material as a shortcut.

## Practical checks

- Public bundle or manifest? Keep it verifiable and cacheable.
- Site credential or private key? Keep it only in the worker.
- Need a response for the browser? Return a public-safe result, not the secret itself.
- Need to route across tenants? Require explicit site identity before any worker lookup.

## Related docs

- `ops/README.md`
- `kernel-migration/BACKLOG.md`
- `libs/legacy/TEMPLATE_BACKEND_GUARDRAILS.md`
