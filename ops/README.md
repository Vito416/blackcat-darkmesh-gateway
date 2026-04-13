# Ops Notes (Gateway)

- Endpoint: `/metrics` (Prom text). Protect with `METRICS_BASIC_USER`/`METRICS_BASIC_PASS` or `METRICS_BEARER_TOKEN`; responds 401 if missing when set.
- Integrity operations runbook: `ops/integrity-runbook.md`.
- Worker secrets trust model: `ops/worker-secrets-trust-model.md`.
- Resource budgets and limited-hosting guidance: `ops/resource-budgets.md`.
- Default alert thresholds: `ops/alerts.md` (targets `wedos_medium`).
- Profile-specific alert thresholds and tuning notes: `ops/alerts-profiles.md`.
- Compare-integrity operator tool: `npm run ops:compare-integrity` compares two gateway integrity snapshots for drift.
- Multi-gateway matrix compare: `npm run ops:compare-integrity-matrix` supports `pairwise` and `all` drift checks.
- Drift summary helper: `npm run ops:build-drift-alert-summary` turns matrix JSON into a profile-aware alert report.
- Consistency preflight helper: `npm run ops:validate-consistency-preflight -- --urls <CSV> [--mode pairwise|all] [--profile wedos_small|wedos_medium|diskless] [--token <VALUE>|--allow-anon]`.
- Consistency export helper: `npm run ops:export-consistency-report -- --matrix <FILE> --out-dir <DIR> [--profile wedos_small|wedos_medium|diskless] [--prefix <NAME>]` writes `*-drift-report.md` and `*-drift-summary.json`.
- Release sign-off helper: `npm run ops:build-release-evidence-pack` consolidates consistency + evidence artifacts into one release pack.
- Release-drill archive manifest: `npm run ops:build-release-drill-manifest -- --dir <drill-dir> --out <release-drill-manifest.json>` plus `npm run ops:validate-release-drill-manifest -- --file <release-drill-manifest.json> --strict` writes and validates the machine-checked drill archive manifest used in sign-off.
- Release-drill artifact completeness check: `npm run ops:check-release-drill-artifacts -- --dir <drill-dir> --strict --json` verifies the final mandatory artifact set and strict cross-file consistency.
- Release evidence ledger generator: `npm run ops:build-release-evidence-ledger -- --dir <drill-dir> --decision pending [--strict]` emits `release-evidence-ledger.md/.json` with artifact hashes and overall ready/blocked status.
- Decommission evidence log generator: `npm run ops:build-decommission-evidence-log -- --dir <drill-dir> --decision pending [--strict]` emits `decommission-evidence-log.md/.json` including manual-proof link fields and a separate automation/AO-manual state split.
- Decommission manual-proof scaffold: `npm run ops:init-decommission-manual-proofs -- --dir <drill-dir> [--force]` generates JSON + Markdown placeholders for recovery/fallback/rollback/approvals proof links.
- Decommission manual-proof checker: `npm run ops:check-decommission-manual-proofs -- --file <drill-dir>/decommission-evidence-log.json [--strict] [--json]` validates recovery/fallback/rollback/approvals links and returns `pending` (non-strict) vs hard failure (strict).
- Decommission readiness summary: `npm run ops:check-decommission-readiness -- --dir <drill-dir> --ao-gate ops/decommission/ao-dependency-gate.json [--strict] [--json]` emits `automationState`, `aoManualState`, and `closeoutState` so `automation-complete`, `ao-manual-pending`, and `ao-manual-blocked` are not conflated.
- Production GO/NO-GO summary: `npm run ops:check-production-readiness -- [--dir ops/decommission] [--ao-gate <file>] [--manual-log <file>] [--json]` prints a concise closeout decision with actionable blockers only, including missing manual proof links from `decommission-evidence-log.json`.
- Cross-repo dataflow summary: `npm run ops:audit-cross-repo-dataflow -- --strict --json` validates gateway<->AO<->write<->worker contract coherence and reports P0/P1 findings.
- Decommission closeout artifact validator: `npm run ops:validate-decommission-closeout -- --file <drill-dir>/decommission-closeout.json [--strict] [--json]` verifies closeout shape and can hard-fail when closeout is not `ready`.
- Worker-routing config checker: `node scripts/check-template-worker-routing-config.js --url-map <json> [--token-map <json>] [--strict] [--json]` validates tenant URL/token map shape before routing is published.
- Worker-routing scaffold helper: `node scripts/init-template-worker-routing.js --sites <csv> [--url-map-out <file>] [--token-map-out <file>] [--force]` generates the routing map skeleton for a new site set.
- Worker-routing example payloads: `config/template-worker-routing.example.json`, `config/template-worker-token-map.example.json`, and `config/template-worker-signature-ref-map.example.json` are non-secret operator templates that can be copied into repo vars/secrets before running strict checks.
- Worker-map coherence checker: `npm run ops:check-template-worker-map-coherence -- --require-sites <csv> --require-token-map --require-signature-map --strict --json` validates URL/token/signature-ref map alignment for the same site set.
- Template signature-ref map checker: `npm run ops:check-template-signature-ref-map -- --strict --json` reads `GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP` from repo vars/secrets in CI; when it is unset, the checker reports a deterministic `blocked` status instead of guessing.
- Template variant map checker: `npm run ops:check-template-variant-map -- --require-sites <csv> --strict --json` validates gateway template variant routing (`variant`, `templateTxId`, `manifestTxId`) from `GATEWAY_TEMPLATE_VARIANT_MAP`.
- Template variant map config validator: `npm run ops:validate-template-variant-map-config -- --strict --require-sites <csv>` enforces txid shape + required-site coverage (used in CI/audit gates).
- Template variant rollback helper: `node scripts/build-template-variant-fallback-map.js --file ./tmp/template-variant-map.json --fallback-variant signal --sites site-alpha,site-beta --template-txid <txid> --manifest-txid <txid> > ./tmp/template-variant-map.rollback.json` rewrites selected sites to a known-safe fallback variant map.
- Worker-secrets trust-model validator: `npm run ops:validate-worker-secrets-trust-model -- --help` is the companion machine check for `ops/worker-secrets-trust-model.md` and should stay a strict CI gate once wired.
- Template secret-smuggling guard: `/template/call` recursively scans payloads for secret-like fields and fail-closes before any upstream fetch; keep the matching tests in `tests/runtime-template-secretGuard.test.ts` and `tests/template-api.test.ts` green.
- Forget-forward semantics: `/cache/forget` stays local-200 even if the optional worker forward skips, times out, or fails; the relay is best-effort only and uses the `GATEWAY_FORGET_FORWARD_*` settings when enabled.
- Core hash evidence: `src/runtime/core/hash.ts` and `tests/runtime-core-hash.test.ts` provide the gateway-owned SHA-256 helpers that replace the remaining black-box core hashing path.
- TypeScript config migration: `tsconfig.json` now uses `NodeNext`, which removes the deprecated `moduleResolution=node10` path and keeps the repo aligned with current TypeScript tooling.
- AO gate evidence quality check: `npm run ops:check-ao-gate-evidence -- --file ops/decommission/ao-dependency-gate.json [--strict] [--json]`.
- Final migration summary validator: `npm run ops:validate-final-migration-summary -- --file ops/decommission/FINAL_MIGRATION_SUMMARY.md [--strict] [--json]`.
- Signoff record validator: `npm run ops:validate-signoff-record -- --file ops/decommission/SIGNOFF_RECORD.md [--strict] [--json]`.
- Decommission closeout one-shot: `node scripts/run-decommission-closeout.js --dir <drill-dir> --ao-gate ops/decommission/ao-dependency-gate.json [--operator ...] [--decision pending|go|no-go] [--strict]` assembles the final machine closeout log, but AO/manual proofs may still be open and must be recorded separately as `ao-manual-pending` or `ao-manual-blocked` instead of generic blocked state.
- Closeout validator order: generate the drill manifest, validate the manifest, run `check-decommission-manual-proofs`, check the archived drill artifacts, build the evidence ledger/log, then run readiness and AO gate evidence checks before signoff.
- Evidence quality rule: keep machine verification and AO/manual proof links as separate artifacts in the closeout bundle; both are required before the final signoff record can move to `GO`.
- WEDOS profile readiness validator: `npm run ops:validate-wedos-readiness -- --profile wedos_small|wedos_medium|diskless [--env-file <FILE>] [--strict]`.
- Legacy no-import evidence checker: `npm run ops:check-legacy-no-import-evidence -- [--root src] [--modules <csv>] [--strict] [--json]` scans `src/**` for references to retired legacy import roots (`libs/legacy/<module>`) and emits machine-readable evidence for the runtime boundary gate.
- Retired path guard: `npm run ops:check-retired-path-references -- --strict --json` scans active automation surfaces (`.github/workflows`, `scripts`, `package.json`) for retired path usage such as `kernel-migration/` and old `security/crypto-manifests/`.
- Runtime config boundary check: `npm run ops:check-config-loader-runtime-boundary -- [--root src] [--strict] [--json]` flags any raw `process.env` usage under `src/runtime/**` outside `src/runtime/config/loader.ts`; CI runs the strict form as a hard gate.
- Mailing secret boundary check: `npm run ops:check-mailing-secret-boundary -- [--root src/runtime/mailing] [--strict] [--json]` ensures mailing request-path runtime code stays public-safe and does not read local secret env sources.
- AO dependency gate source: `ops/decommission/ao-dependency-gate.json` provides machine-readable P0.1/P1.1/P1.2 status for release gating.
- AO dependency gate validation: `npm run ops:validate-ao-dependency-gate -- --file ops/decommission/ao-dependency-gate.json` checks gate structure and closed-check evidence references.
- AO dependency gate validation artifact: archive `ao-dependency-gate.validation.txt` from drills as the machine output proof for gate checks.
- Release sign-off checklist generator: `npm run ops:build-release-signoff-checklist -- --pack <release-evidence-pack.json> [--strict]`.
- Release readiness evaluator: `npm run ops:check-release-readiness -- --pack <release-evidence-pack.json> [--strict] [--json]`.
- One-shot release drill orchestrator: `npm run ops:run-release-drill -- --urls <CSV> --out-dir <DIR> [--profile ...] [--mode ...] [--token ...] [--allow-anon] [--release ...] [--strict]`.
- Live strict drill one-shot: `npm run ops:run-live-strict-drill -- [--dry-run] [--allow-anon] [--skip-forget-forward]` runs preflight + strict drill + strict closeout checks with one command.
- Pre-live decommission bootstrap (no live gateways yet): `npm run ops:bootstrap-prelive-decommission-artifacts:tmp -- --release 1.4.0` seeds a deterministic baseline artifact set under `tmp/decommission-prelive` so readiness can report `automation-complete` while AO checks remain open.
- Release drill runbook: `ops/release-drill-runbook.md`.
- Fresh-machine production bootstrap runbook: `ops/fresh-machine-production-bootstrap-runbook.md` (prereqs, env bootstrap, strict preflight, strict drill path).
- WEDOS live handoff folder: `ops/live-wedos/` (VPS + cloudflared rollout and production-like validation tooling).
- Production gaplist tracker for 1.4.0: `ops/decommission/PRODUCTION_READY_GAPLIST_1.4.0.md`.
- Evidence bundle scripts: `npm run ops:export-integrity-evidence` and `npm run ops:validate-integrity-attestation` produce and verify the compare/attestation evidence set used for go/no-go checks.
- Bundle indexing/exchange pack: `npm run ops:index-evidence-bundles` and `npm run ops:build-attestation-exchange-pack` for portable review artifacts.
- Schema validation: keep attestation payloads aligned with `ops/schemas/integrity-attestation.schema.json` before archiving the bundle.
- Dashboard focus: `ops/dashboards/gateway-metrics.yml` now includes integrity mirror consistency, rate-limit tuning, and 429 pressure panels so you can spot drift and overload early.
- Key metrics:
  - Cache: `gateway_cache_hit_total`, `gateway_cache_miss_total`, `gateway_cache_expired_total`, `gateway_cache_store_reject_total`, `gateway_cache_store_reject_size_total`, `gateway_cache_store_reject_capacity_total`, `gateway_cache_size`.
  - Webhooks: `gateway_webhook_stripe_verify_fail_total`, `gateway_webhook_paypal_verify_fail_total`, `gateway_webhook_replay_total`, `gateway_webhook_cert_allow_fail_total`, `gateway_webhook_cert_pin_fail_total`, `gateway_webhook_cert_cache_size`.
  - Rate limit: `gateway_ratelimit_blocked_total`, `gateway_ratelimit_pruned_total`, `gateway_ratelimit_buckets`, `gateway_ratelimit_override_count`, `gateway_ratelimit_effective_max_last`.
  - Replay detector: `gateway_webhook_replay_pruned_total`, `gateway_webhook_replay_ttl_ms`, `gateway_webhook_replay_max_keys`.
  - Integrity incidents/state: `gateway_integrity_incident_total`, `gateway_integrity_incident_duplicate_total`, `gateway_integrity_incident_auth_blocked_total`, `gateway_integrity_incident_role_blocked_total`, `gateway_integrity_incident_notify_fail_total`, `gateway_integrity_state_read_total`, `gateway_integrity_mirror_mismatch_total`, `gateway_integrity_mirror_fetch_fail_total`.
  - Integrity audit tracking: `gateway_integrity_audit_seq_from`, `gateway_integrity_audit_seq_to`, `gateway_integrity_audit_lag_seconds`, `gateway_integrity_checkpoint_age_seconds`, `gateway_integrity_audit_stream_anomaly_total`.
- WAL/DLQ (from Write export): see Write dashboards for `write.webhook.dlq_size` and `write.wal.bytes` to spot downstream backlog.
- Cache purge: `/cache/forget` (POST) with `GATEWAY_FORGET_TOKEN` bearer; body `{subject?, key?}`; returns `{removed, forwarded}`.
- AO hook: configure AO ForgetSubject to POST to `/cache/forget` with the same token to wipe subject-indexed blobs.
- Optional forward hook: set `GATEWAY_FORGET_FORWARD_URL` plus `GATEWAY_FORGET_FORWARD_TOKEN` and (optionally) `GATEWAY_FORGET_FORWARD_TIMEOUT_MS` to relay successful forgets to a per-site worker; the local forget stays 200 even if the forward times out or fails.
- Forget-forward operator example: `config/forget-forward.example.env` provides a non-secret baseline for relay URL/token/timeout wiring.
- Forget-forward config checker: `npm run ops:check-forget-forward-config -- [--strict] [--json]` validates the optional relay boundary and treats a missing URL as pending while still flagging invalid URLs, blank tokens, and out-of-range timeouts.
- PSP certs: allowlist prefixes `PAYPAL_CERT_ALLOW_PREFIXES`, pins `GW_CERT_PIN_SHA256`, TTL `GW_CERT_CACHE_TTL_MS`; cert cache size exported.
- Diskless mode: `GATEWAY_INTEGRITY_DISKLESS=1` (or `GATEWAY_INTEGRITY_CHECKPOINT_MODE=diskless`) disables checkpoint file IO and keeps integrity state memory-only.
- Checkpoint age: compare `gateway_integrity_checkpoint_age_seconds` against your max-age policy; stale checkpoints should be treated as absent.
- Scheduled CI consistency smoke: set repo variable `CONSISTENCY_URLS` (optional `CONSISTENCY_MODE`, `GATEWAY_RESOURCE_PROFILE`) and secret `GATEWAY_INTEGRITY_STATE_TOKEN` when state auth is enabled.
- Scheduled consistency preflight: CI now fails fast on missing/invalid `CONSISTENCY_*` config and reports issues in job summary; for public state endpoints only, set `CONSISTENCY_ALLOW_ANON=1`.
- CI release artifact: workflow job `release-evidence-pack` now downloads consistency/evidence artifacts and uploads the sign-off bundle (`release-evidence-pack`, AO gate validation, drill manifest/check, and release evidence ledger).

## Template worker map preflight

Use the non-secret example files in `config/` as a baseline, replace placeholder values, then run strict checks:

```bash
export GATEWAY_TEMPLATE_WORKER_URL_MAP="$(cat config/template-worker-routing.example.json)"
export GATEWAY_TEMPLATE_WORKER_TOKEN_MAP="$(cat config/template-worker-token-map.example.json)"
export GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP="$(cat config/template-worker-signature-ref-map.example.json)"
export GATEWAY_TEMPLATE_VARIANT_MAP="$(cat config/template-variant-map.example.json)"

node scripts/check-template-worker-routing-config.js \
  --url-map "$GATEWAY_TEMPLATE_WORKER_URL_MAP" \
  --token-map "$GATEWAY_TEMPLATE_WORKER_TOKEN_MAP" \
  --strict --json

node scripts/check-template-worker-map-coherence.js \
  --require-sites site-alpha,site-beta \
  --require-token-map \
  --require-signature-map \
  --strict --json

node scripts/check-template-signature-ref-map.js \
  --require-sites site-alpha,site-beta \
  --strict --json

node scripts/check-template-variant-map.js \
  --require-sites site-alpha,site-beta \
  --strict --json

node scripts/validate-template-variant-map-config.js \
  --strict \
  --allow-placeholders \
  --require-sites site-alpha,site-beta

# For live secret-backed maps, rerun without --allow-placeholders.

set -a
source config/forget-forward.example.env
set +a
node scripts/check-forget-forward-config.js --strict --json
```

## Release drill flow
See `ops/release-drill-runbook.md` for the canonical step-by-step release drill, expected artifacts, and triage matrix.
For first-time host setup, start with `ops/fresh-machine-production-bootstrap-runbook.md` before running the release drill.

## Production guardrails
- Cache: keep `gateway_cache_size` below the host memory budget with a clear ceiling per deployment tier.
- Rate limit: keep `gateway_ratelimit_buckets` cardinality flat; if it climbs, reduce key granularity before raising limits.
- Replay: keep `gateway_webhook_replay_total` limited to provider retry windows; a rising replay rate usually means duplicate deliveries or clock skew.
- Checkpoints: prefer tmpfs or no-path operation on small hosts, and only restore signed checkpoints that are still fresh.
- Integrity trio: if audit lag, checkpoint staleness, and stream anomalies all rise together, treat AO fetch cadence as the first suspect before widening thresholds.
- When an alert is profile-specific, keep the threshold below the corresponding budget ceiling and tune `for:` windows before raising the numeric trigger.

## Prom scrape example
```yaml
scrape_configs:
  - job_name: gateway
    static_configs:
      - targets: ["gateway.local:8787"]
    metrics_path: /metrics
    basic_auth:
      username: ${GATEWAY_METRICS_USER}
      password: ${GATEWAY_METRICS_PASS}
```

## Grafana panel: Worker Notify health
```yaml
title: "Worker Notify"
targets:
  - expr: increase(worker_notify_retry_total[5m])
    legendFormat: retry
  - expr: increase(worker_notify_failed_total[5m])
    legendFormat: failed
  - expr: increase(worker_notify_breaker_open_total[5m])
    legendFormat: breaker_open
  - expr: increase(worker_notify_breaker_blocked_total[5m])
    legendFormat: breaker_blocked
  - expr: increase(worker_notify_deduped_total[5m])
    legendFormat: deduped
```

## Grafana panel: Gateway cache / webhooks / PSP
```yaml
title: "Gateway Cache/Webhooks"
panels:
  - type: timeseries
    title: Cache hit/miss
    targets:
      - expr: rate(gateway_cache_hit_total[5m])
        legendFormat: hit
      - expr: rate(gateway_cache_miss_total[5m])
        legendFormat: miss
      - expr: rate(gateway_cache_expired_total[5m])
        legendFormat: expired
  - type: timeseries
    title: Webhook verify failures
    targets:
      - expr: rate(gateway_webhook_stripe_verify_fail_total[5m])
        legendFormat: stripe_fail
      - expr: rate(gateway_webhook_paypal_verify_fail_total[5m])
        legendFormat: paypal_fail
      - expr: rate(gateway_webhook_replay_total[5m])
        legendFormat: replay
  - type: timeseries
    title: PSP cert issues
    targets:
      - expr: rate(gateway_webhook_cert_allow_fail_total[5m])
        legendFormat: cert_allow_fail
      - expr: rate(gateway_webhook_cert_pin_fail_total[5m])
        legendFormat: cert_pin_fail
      - expr: gateway_webhook_cert_cache_size
        legendFormat: cert_cache_size
```
