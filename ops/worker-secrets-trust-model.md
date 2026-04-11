# Worker Secrets Trust Model

This document formalizes the boundary for the gateway/template/worker split.

## Invariant

- Templates are public and verifiable.
- Gateway is universal and public-serving.
- Secrets live only in the per-site worker.
- Gateway may route, validate, cache, and proxy public or encrypted data, but it must not own site secrets.
- Mailing is a public request-path boundary: the gateway can validate recipients, sanitize content, and enqueue delivery intent, but worker-owned credentials stay outside the request path.

## Component roles

- `blackcat-templates`: public template bundles, manifests, hashes, and other verifiable assets.
- `blackcat-darkmesh-gateway`: public edge, request router, integrity gate, and policy enforcement point.
- Per-site worker: secret holder for PSP keys, SMTP credentials, OTP secrets, and other site-specific private material.
- Mailing dispatch: public-safe queue/transport helpers live in the gateway runtime, but any SMTP/API credential, relay token, or tenant-specific secret remains worker-owned and injected from outside the request path.

## Allowed data flow

- Browser -> Gateway -> public template bundle / public AO state.
- Browser -> Gateway -> validated action request that contains no secrets.
- Gateway -> Worker -> secret-dependent operation, with the worker holding the secret material.
- Worker -> Gateway -> bounded response or signed result needed to finish a public flow.
- Gateway -> AO/Write -> public or pseudonymous state only.
- Gateway request-path code must never require `process.env`, `import.meta.env`, or similar local secret access to prepare a mail request.

## Forbidden data flow

- Templates reading worker secrets directly.
- Gateway persisting plaintext secrets, long-lived secret copies, or secret caches.
- Public template bundles embedding per-site secrets.
- Browser or template code bypassing gateway policy to reach worker internals.
- AO/Write receiving raw worker secrets instead of hashes, refs, or public results.

## Boundary checks

- Templates must be verified against a trusted manifest or equivalent signed/public proof before serving.
- Gateway request handlers must reject any payload that tries to smuggle worker-secret fields.
- Template `/template/call` payloads are scanned recursively for secret-like keys and fail closed before any upstream call.
- Worker-facing calls must be explicit, site-scoped, and authenticated.
- Secret-bearing values must stay on the worker side unless they are transformed into a public-safe result.
- Any cache in gateway must be TTL-bounded and treat encrypted envelopes as opaque; secrets themselves never enter the cache.
- Mailing runtime checks should fail closed if a local secret source appears in the request path.

## Machine checks

- `check-template-worker-routing-config`: strict CI gate for published URL/token map shape and site coverage; local runs are advisory when exploring a new routing set.
- `init-template-worker-routing`: scaffold-only helper for operators; it prepares maps and does not enforce policy by itself.
- `validate-worker-secrets-trust-model`: strict CI gate for the trust-model doc and boundary references once wired; local runs should be treated as a preflight, not as enforcement.
- `check-mailing-secret-boundary`: strict CI gate for request-path secret access in mailing code; this is the active enforcement example for the trust model.
- `check-config-loader-runtime-boundary`: strict CI gate for request-path env access; it is the complementary runtime-secret boundary check.

## Operational rules

- If a flow needs a secret, the worker owns the secret and performs the secret-dependent step.
- If a flow is public, keep it in templates, AO read state, or gateway policy checks.
- If a flow mixes public and secret data, split it so the gateway only sees the public envelope and the worker only sees the secret dependency.
- Rotate worker secrets per site; do not use gateway-wide secret material as a shortcut.
- For mailing, prefer public-safe request payloads plus worker-injected transport config; do not make the browser or template depend on local SMTP credentials.

## Practical checks

- Public bundle or manifest? Keep it verifiable and cacheable.
- Site credential or private key? Keep it only in the worker.
- Mailing request or dispatch intent? Keep it public-safe; only the worker may supply delivery credentials.
- Need a response for the browser? Return a public-safe result, not the secret itself.
- Need to route across tenants? Require explicit site identity before any worker lookup.

## Mailing ownership decision

- Final decision: the gateway owns the public queue, payload policy, sanitizer, and delivery orchestration surface.
- Final decision: the worker owns all secret-bearing mailing material, including SMTP/API credentials and per-site relay keys.
- Enforcement: the gateway mailing runtime must not read local secrets from the request path; the repository now carries a dedicated secret-boundary check for that rule.

## Related docs

- `ops/README.md`
- `kernel-migration/BACKLOG.md`
- `libs/legacy/TEMPLATE_BACKEND_GUARDRAILS.md`

## Optional notes

- This trust model is an enforcement baseline; environment-specific rollout notes can be tracked alongside release drill evidence when needed.
