# BlackCat Crypto – Roadmap

This roadmap tracks the evolution of `blackcat/crypto` as the centralized cryptography engine for the BlackCat ecosystem.

## Stage 1 – Foundations ✅
- Composer package + autoload; baseline `CryptoManager` and runtime config bootstrap.
- `KeyRegistry` with filesystem key sources and versioned key history.
- AEAD implementation (libsodium XChaCha20-Poly1305) with abstractions for future algorithms.

## Stage 2 – HMAC & slots ✅
- `HmacService` with per-slot keys and rotation support (`sign()`, rotation-safe `verify()`, `candidates()`).
- Standardized slot naming and slot-driven key resolution.

## Stage 3 – Double-envelope encryption ✅
- Context encryption: local AEAD + optional KMS wrapping (double envelope).
- `Envelope` DTO carries metadata (client id, wrap count, context, key id).

## Stage 4 – KMS routing & async jobs ✅
- `KmsRouter` with weighted routing, context matching, health reporting, suspend/resume.
- `WrapQueueInterface` + queue backends + `RotationCoordinator` for asynchronous rewrap.

## Stage 5 – Quantum-ready abstractions ✅
- AEAD driver switch (runtime config `crypto.aead=xchacha|hybrid`).
- Rotation policies (`maxAgeSeconds` / `maxWraps`) + scheduling via wrap queue.
- CLI baseline (`bin/crypto`) + documentation + tests.

## Stage 6 – PQ ops & advanced CLI ✅
- Hybrid AEAD placeholder available; CLI tools for inspection/diagnostics (`wrap:status`, `kms:diag`).
- Rotation policies integrated into runtime config (`crypto.rotation`).

## Stage 7 – Distributed control-plane hooks ✅
- SSE / watchdog hooks for monitoring (`telemetry:sse`, `kms:watchdog`).
- Multi-backend KMS config documented and supported.

## Stage 8 – Production rollout ✅
- `HttpKmsClient` supports real wrap/unwrap with auth + timeouts.
- Persistent `FileWrapQueue` via runtime config (`crypto.wrap_queue`).
- Metrics exports (`metrics:export`) for JSON/Prometheus/OTel.

## Stage 9 – Federated governance ✅
- Governance flow primitives (`gov:assess`, approval feed) and richer intent tagging.
- Core bridge (`BlackCat\Crypto\Bridge\CoreCryptoBridge`) unifies `blackcat-core` crypto with the same slots/keys.

## Stage 10 – Bootstrap & key standardization ✅
- `PlatformBootstrap::boot()` provides a one-call bootstrap for other repos (runtime config + optional bridges).
- Standard key naming: `*_vN.key` (+ optional `*.hex` / `*.b64`).
- Rotation-safe HMAC patterns with `keyId` and `candidates()`.

## Current status

Stage 11 is **in progress**.

## Stage 11 – Data plane fusion (in progress)
- “Zero-boilerplate” DB write-path encryption via `blackcatacademy/blackcat-database-crypto`.
- `keys:lint` as a CI gate for application repos (manifest + keys dir validation).
- Expanded telemetry snapshots for CI and observability pipelines.

## Stage 12 – Autonomous compliance mesh (planned)
- Automated enforcement runbooks (manifest drift → migrations/rewrap/ticketing).
- Tools that suggest new contexts based on data profiling and open PRs to the manifest repo.

## Stage 13 – Trustless proofs & customer control (planned)
- Signed wrap/unwrap events and verifiable audit trails.
- BYOK/BYO-KMS modes with per-tenant policies and geo-fencing.

## Stage 14 – MPC / threshold fabric (exploratory)
- Threshold keying (Shamir/FROST) for high-value keys and recovery flows.

## Stage 15 – Attested edge & BYOK at scale (planned)
- Attestation-first clients (TEE/HSM) and policy enforcement before wrap/unwrap.

## Stage 16 – Zero-touch assurance (exploratory)
- Automated incident runbooks: auto-fence KMS nodes, failover, and audit feeds.

## Stage 17+ (future)
- Privacy-preserving analytics channels (TEE/HE) for aggregated insights without plaintext.
- Continuous assurance + compliance exports (SOC2/ISO/NIS2 evidence).
- Policy-as-code and explainable routing decisions.
