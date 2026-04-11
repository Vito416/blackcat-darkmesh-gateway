# Template Backend Contract

This artifact defines the strict boundary between templates and the gateway backend.
It exists so templates can only call approved backend actions, with the exact route,
method, authorization requirement, schema references, rate-limit profile, and
idempotency rule documented in one machine-checkable place.

## Purpose

The gateway backend is intentionally more powerful than template code. That power
must not leak into templates. This contract keeps template authors inside a narrow
API surface and makes the allowed surface auditable.

The contract is meant to prevent the template layer from gaining any of these
capabilities:

- raw SQL execution
- arbitrary outbound HTTP
- dynamic code evaluation
- secret access

In practice, the gateway must treat the contract as an allow-list, not as a hint.
Anything not declared in `allowedActions` is forbidden by default.

## Threat model

The main risks are:

- a template trying to call a backend action that was not approved for it
- a template attempting to expand its privileges through a hidden path or method
- a compromised template trying to read secrets or reach external systems directly
- a contract drift between template release, gateway routing, and rate-limit policy

The contract reduces those risks by making the approved surface explicit and
schema-validated.

## Schema usage lifecycle

1. A template release declares its `templateId` and `templateVersion`.
2. The contract lists every approved backend action in `allowedActions`.
3. Each action binds the template call to a method, path, required role, request
   and response schema reference, rate-limit profile, and idempotency mode.
4. The contract is validated before release artifacts are considered complete.
5. The same contract is used later for review, audit, and decommission evidence.

The optional `integrity` block is reserved for future manifest and bundle binding
once the template release process needs stronger root/hash provenance.

## Validation gate placement

The contract should be validated in three places:

- CI: fail fast when the schema is malformed or the approved action set is invalid.
- Release evidence: archive the validated contract alongside the release pack.
- Decommission closeout: prove the legacy repos can be retired only after the
  template/backend contract is defined, validated, and mapped to the live gateway API.

This keeps the contract visible both during development and during final closeout.
