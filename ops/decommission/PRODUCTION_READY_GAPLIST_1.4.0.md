# Gateway 1.4.0 Production-Ready Gaplist

Status date: 2026-04-14

This is the practical gaplist for moving from "code/tests green" to "live rollout ready" on the new VPS deployment model.

Latest audit snapshot:
- `npm run build` -> pass
- Targeted hardening tests -> pass (`template-config-route`, `template-host-site-binding`, cross-repo audit tests)
- `npm run ops:audit-cross-repo-dataflow -- --strict --json` -> **ready_with_warnings** (P0=0, P1=0)
- `node scripts/check-production-readiness-summary.js --json` -> **GO** (manual proof set complete)
- Cross-repo dataflow audit: `ops/decommission/CROSS_REPO_DATAFLOW_AUDIT_2026-04-13.md`

## P0 (must close before first real traffic)

- [ ] Deploy latest gateway runtime to live VPS and confirm `/template/config` + strict query guard behavior match audited code.
- [x] Add `Host -> siteId` fail-closed routing logic in gateway runtime.
- [ ] Validate live host-map behavior with real domains (`allowed host`, `unmapped host`, `site_id_host_mismatch`).
- [x] Remove caller-supplied write role trust from gateway write envelope (`src/templateApi.ts`).
- [x] Bind role into detached signature canonical fields across worker + write verifier (same canonical in all sign/verify paths). See `ops/decommission/ROLE_BINDING_PLAN_2026-04-13.md`.
- [x] Extend worker `/sign` allowlist to accept role fields for signed role binding.
- [ ] Re-run strict production-like drill and archive evidence bundle with real endpoints.
- [ ] Fill manual closeout proofs in `ops/decommission/decommission-evidence-log.json` (Recovery, AO fallback, Rollback, Approvals).

## P1 (high-value hardening right after go-live)

- [ ] Add one e2e smoke that verifies `site -> variant -> templateTxId -> /template/call` path.
- [x] Add end-to-end trace propagation (`x-trace-id`) across gateway -> worker -> write adapter -> AO result.
- [ ] Add live release-drill evidence bundle from real gateway endpoints and archive links in release docs.
- [ ] Add write-intent policy map (`signatureRef -> allowed actions/roles`) and enforce it in write/runtime boundary.

## P2 / nice-to-have (future-proof + operator speed)

- [ ] Add changelog generator for template variant releases (UX diff + hash diff).
- [ ] Add rollback helper for variant map (flip all sites to safe variant in one command).
- [ ] Add load/perf profile snapshots per VPS tier (`small`, `medium`, `burst`) from real traffic.
- [ ] Add dashboard panel for variant/action error rates (`site`, `variant`, `action`).
- [ ] Add versioned bridge contract checks (gateway<->worker and gateway<->AO adapters) in CI.

## Release confidence summary

- Core gateway runtime hardening and tests are green locally.
- Live runtime still needs redeploy/verification for drift-sensitive routes.
- Main technical blocker (write-role trust) is closed: role is now signature-bound across gateway/worker/write canonical paths.
- Operational blocker is closeout evidence completion (manual proof links).
