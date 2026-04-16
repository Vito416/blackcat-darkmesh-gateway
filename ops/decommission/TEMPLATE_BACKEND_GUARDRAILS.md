# Template Backend Guardrails

This document defines the permanent safety boundary between public templates and the gateway backend.

## Core rule

Templates are public and untrusted by default. They may only call declared gateway endpoints. Templates never get direct access to:

- worker secrets
- AO write authority keys
- database credentials
- local filesystem
- internal admin routes

## Enforcement

1. Template calls must pass through `/template/call`.
2. Endpoint allowlist is defined in `config/template-backend-contract.json`.
3. Runtime rejects secret-like fields using `src/runtime/template/secretGuard.ts`.
4. Worker routing requires explicit per-site URL/token/signature-ref maps.
5. Audit logs and metrics must capture blocked template attempts.

## Operational checks

Run these checks before release:

```bash
npm run ops:validate-template-backend-contract -- --strict --json
npm run ops:check-template-worker-map-coherence -- --require-sites <csv> --require-token-map --require-signature-map --strict --json
npm run ops:check-template-signature-ref-map -- --require-sites <csv> --strict --json
npm run ops:check-forget-forward-config -- --strict --json
```

## Trust model alignment

- Public template composition remains verifiable and reproducible.
- Sensitive actions are delegated to site-specific workers (secrets stay off gateway and templates).
- Gateway remains universal/multi-tenant while preserving hard per-site trust boundaries.
