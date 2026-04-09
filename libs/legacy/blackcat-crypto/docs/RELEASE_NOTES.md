## Release Notes

### Governance + Telemetry refresh
- Added `gov:assess` CLI for low-risk auto-approvals (unwrap/decrypt). Tune with `--max-amount`, `--max-sensitivity`, pass context via `--tenant`, `--sensitivity`, `--amount`.
- LowRiskApprovalService available as a PHP helper for service-layer governance.
- New lightweight HTTP endpoint `public/governance.php` for runtime approval checks (POST JSON; configurable via `GOV_MAX_AUTO`, `GOV_MAX_SENSITIVITY`, `GOV_RATE_BURST`, `GOV_RATE_WINDOW`, `GOV_TENANT_LIMITS_JSON`).
- Intent telemetry now tags env/product/pii_label/workload_tier/kms_client/cipher_suite/db_hook/governance_id/approval_status; archives rotate via `archiveMaxBytes`/`archiveKeep`.
- Telemetry exporter emits richer intent tag counts (Prometheus/OpenTelemetry/JSON).
- Database crypto hook bridge exposes telemetry snapshots for DB-facing tooling, now enriched with CI metadata when present (e.g., GitHub Actions env).
- New `db:snapshot` CLI exports DB crypto hook telemetry in json/prom/otel for db-crypto CI.
- Added governance intent logging + approval decisions (see `GovernanceApprovalService`) for low-risk unwrap/decrypt with audit tags.
- Approval inbox feed (`BlackCat\Crypto\Governance\ApprovalInbox`) for queuing/approving/denying requests, emitting governance telemetry automatically.
- HSM/KMS metadata now reports allowed ciphers, key version, and fingerprints; unwrap checks version by config.

### KMS hardening
- HTTP KMS client now supports bearer/basic auth, custom headers, mTLS (CA/cert/key), peer verification toggle, and independent connect/read timeouts.
- AEAD tag length is validated for HSM KMS (fails fast if outside 8–32 byte window); allow/deny cipher lists and auth options validated at startup.
- HSM shim persists `suspend` state (optional JSON file) and auto-resumes after expiry; health now reports request timeout and current suspend status; per-client timeouts configurable.

### How to try
- Enable intent collector: `BLACKCAT_CRYPTO_INTENTS=1 ./bin/crypto telemetry:intents --format=prom`.
- Governance check: `./bin/crypto gov:assess --tenant=acme --sensitivity=low --amount=500`.
- Inspect intent archive/recents: `./bin/crypto telemetry:intents --limit=20`.

### DX / CI improvements
- Added `keys:lint` CLI (manifest + keys dir validation) suitable as a CI gate for other repos.
- `key:generate` is deprecated (alias for `key:rotate`) to enforce versioned key naming and manifest-driven lengths.
