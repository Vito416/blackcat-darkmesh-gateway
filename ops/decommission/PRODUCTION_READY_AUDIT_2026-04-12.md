# Gateway Production/Future-Proof Audit (2026-04-12)

## Scope

- Repository: `blackcat-darkmesh-gateway`
- Goal: assess production-ready state for a fresh-machine rollout and identify remaining blockers before wider gateway activation.

## Baseline checks executed

- `npm run build` -> pass
- `npm test` -> pass (baseline suite)
- `npm run test:hardening` -> pass
- `npm run ops:audit-all` -> pass
- `npm audit --omit=dev --json` -> pass (0 vulnerabilities)
- `npm run ops:check-release-drill-artifacts -- --dir ops/decommission --strict --json` -> pass
- `npm run ops:check-decommission-readiness -- --dir ops/decommission --ao-gate ops/decommission/ao-dependency-gate.json --json` -> pass (`closeoutState=ready`)
- `npm run ops:check-production-readiness -- --json` -> **GO** (`automationState=complete`, `aoManualState=complete`, `blockerCount=0`)
- `npm run ops:check-template-variant-map -- --require-sites site-alpha,site-beta --strict --json` (with example map) -> pass

## Findings (ordered by severity)

## P0 blockers (must be resolved before release closeout)

None at this time (machine checks report GO).

## P1 improvements (high value for fresh-machine rollout)

1. Add one smoke artifact proving end-to-end template variant selection on a fresh machine (`site -> variant -> template txid -> resolve-route`).
2. Add explicit live drill evidence links (real endpoints, real worker maps) to release signoff references.

## P2 / nice-to-have

1. Add schema file for `GATEWAY_TEMPLATE_VARIANT_MAP` and include it in CI docs validators.
2. Add templated release notes for variant updates so ops can diff UX changes without reading full HTML.
3. Add one hardened VPS bootstrap checklist update (cloudflared + systemd + service probes) after first live operator rehearsal.

## Recommended execution split

- Track A (CI/runtime guards): workflow path fixes + regression checks.
- Track B (release evidence automation): deterministic artifact generation and strict verification flow.
- Track C (ops docs): fresh-machine bootstrap, onboarding, and production runbook hardening.
- Track D (AO gate integration docs): required proof links and closeout policy wording.

## Current verdict

- Gateway runtime is in strong shape (build/tests/hardening/security audit are green).
- Release closeout is currently **GO** on machine checks.
- Implemented in this wave:
  - CI path migration to `ops/decommission/*` in `.github/workflows/ci.yml`.
  - Retired-path regression guard (`ops:check-retired-path-references`) added to audit flow and CI.
  - Fresh-machine bootstrap runbook (`ops/fresh-machine-production-bootstrap-runbook.md`).
  - Deterministic strict artifact alignment across release-drill scripts/checkers.
  - New GO/NO-GO CLI summary (`npm run ops:check-production-readiness -- --json`).
  - AO-only status normalization in closeout checks so `automation-complete` and `ao-manual-pending` are split cleanly.
  - Full `ops/decommission` artifact set generated and validated in strict artifact mode.
  - Profile-specific cadence/threshold tuning sync across docs + script + tests.
  - Added template variant map guardrails (`config/template-variant-map.example.json`, `ops:check-template-variant-map`) and live handoff folder (`ops/live-vps/README.md`).
  - Wired template variant map checks into strict release-drill flow and drill-artifact completeness checks (`template-variant-map.json` is now a first-class strict artifact).
- Best next move: run one live strict drill with real gateway endpoints + real variant map and archive that drill as release-grade evidence.
