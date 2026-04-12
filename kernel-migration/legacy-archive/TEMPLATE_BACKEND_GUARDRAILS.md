# Template Backend Guardrails (Security Model)

This is the baseline model for keeping templates flexible while preventing malicious runtime behavior.

## Core rule

Templates do not get direct backend/database access.
They can only call a controlled Gateway API surface.

## Allowed template runtime capabilities

- fetch public content through approved gateway endpoints
- invoke explicit action endpoints that pass validation/policy checks
- use static assets from trusted manifests only

## Forbidden for template runtime

- arbitrary outbound HTTP from template logic
- raw SQL or direct data-store drivers
- direct worker secret access
- dynamic code execution from untrusted sources

## Gateway controls required

1. Endpoint allowlist
- each template action maps to a declared backend endpoint
- unknown endpoints are rejected

2. Action schema validation
- every request body validated against strict schema
- reject unknown/extra high-risk fields

3. Role and signature checks
- privileged actions require actor role + signature/key checks
- replay protection via nonce/requestId

4. Template integrity
- serve only template bundles that match trusted AO root/manifest
- block revoked or unverified roots

5. Output and side-effect controls
- content sanitization for user-facing rendering paths
- explicit outbound connectors (mailing, PSP, webhooks) behind policy checks

## Operational model

- heavy integrity checks on publish/cache-fill/startup
- lightweight request-path checks for performance on constrained hosts
- degraded mode when integrity or AO trust state is unavailable

## Goal

Developers can build templates quickly in `blackcat-templates`,
but deployment/runtime behavior remains constrained by gateway policy.
