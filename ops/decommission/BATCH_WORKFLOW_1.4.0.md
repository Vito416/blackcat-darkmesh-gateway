# Gateway 1.4.0 Batch Workflow

Status date: 2026-04-12

This is the next execution batch after cleanup, focused on production readiness with fast feedback and parallel work.

## Batch A - Variant map contract gate (P1)

Goal:
- Enforce a strict shape for `GATEWAY_TEMPLATE_VARIANT_MAP`.

Deliverables:
- `config/template-variant-map.schema.json`
- `scripts/validate-template-variant-map-config.js`
- CI + audit wiring for strict validation

Validation:
- `npm run test -- --run tests/validate-template-variant-map-config.test.ts`
- `node scripts/validate-template-variant-map-config.js --file config/template-variant-map.example.json --strict --json`

## Batch B - Runtime variant flow proof (P1)

Goal:
- Ensure `/template/call` can carry `site -> variant -> templateTxId/manifestTxId` context.

Deliverables:
- Runtime injection in template proxy flow
- Tests covering valid, missing-site, malformed-map behavior

Validation:
- `npm run test -- --run tests/template-api.test.ts`

## Batch C - Variant rollback helper (P2/high-value ops)

Goal:
- Provide one-command fallback map generation for incident response.

Deliverables:
- `scripts/build-template-variant-fallback-map.js`
- Tests for full map / subset / invalid inputs

Validation:
- `npm run test -- --run tests/build-template-variant-fallback-map.test.ts`

## Batch D - Pre-live -> live evidence handoff (P0 closeout prep)

Goal:
- Keep local drill artifacts in `tmp/*`, archive only final release evidence intentionally.

Deliverables:
- Runbook updates referencing `tmp/decommission-prelive`
- Artifact expectations aligned with strict drill checker

Validation:
- `npm run ops:bootstrap-prelive-decommission-artifacts:tmp -- --dry-run`
- `npm run ops:check-production-readiness -- --json`

## Batch E - Live final GO gate (P0)

Goal:
- Execute one strict live release drill against real endpoints + real worker maps.

Inputs required:
- real `CONSISTENCY_URLS`
- real `GATEWAY_TEMPLATE_WORKER_*` maps
- real `GATEWAY_TEMPLATE_VARIANT_MAP`
- integrity token and operator signoff context

Validation:
- `npm run ops:run-release-drill -- --strict ...`
- `npm run ops:check-release-drill-artifacts -- --strict --json`
- `npm run ops:check-production-readiness -- --json`

## Completion definition

- All Batch A-C tests pass in CI.
- `ops:audit-all` passes.
- Live strict drill evidence is archived and reviewed.
- Production readiness summary returns `GO` with no blockers.
