# Gateway 1.4.0 Production-Ready Gaplist

Status date: 2026-04-12

This is the practical gaplist for moving from "machine checks green" to "live rollout ready" on a fresh host.

## P0 (must close before first live traffic)

- [ ] Live strict release drill with real gateway endpoints (`ops:run-release-drill --strict`).
- [ ] Real `GATEWAY_TEMPLATE_WORKER_*` maps committed to ops secret store (not repo files).
- [ ] Real `GATEWAY_TEMPLATE_VARIANT_MAP` published and validated (`ops:check-template-variant-map --strict`).
- [ ] Worker signer-ref map verified against real worker outputs (no placeholder refs).
- [ ] Incident auth tokens (`GATEWAY_INTEGRITY_*_TOKEN`) rotated from defaults and documented in on-call vault.

## P1 (high-value hardening right after go-live)

- [ ] Add `ops:check-template-variant-map` to release-drill orchestration so every strict drill archives `template-variant-map.json`.
- [ ] Add template variant map artifact into `release-drill-checks.json` embedded consistency checks.
- [ ] Add schema validation for `GATEWAY_TEMPLATE_VARIANT_MAP` in CI (shape + variant allowlist + txid fields).
- [ ] Add one e2e smoke that verifies site variant selection path (`site -> variant -> template txid -> /template/call`).

## P2 / nice-to-have (future-proof and operator speed)

- [ ] Add changelog generator for template variant releases (UX diff + hash diff).
- [ ] Add rollback helper for variant map (flip all sites to safe fallback variant in one command).
- [ ] Add load/perf profile snapshots per WEDOS tier (`wedos_small`, `wedos_medium`, `diskless`) from real traffic.
- [ ] Add optional dashboard panel for variant-level error rates (`site`, `variant`, `action` labels).

## Release confidence summary

- Build/tests are green.
- Production readiness command currently reports GO on machine checks.
- Remaining risk is mostly operational/live-proof closure, not missing core runtime functionality.
