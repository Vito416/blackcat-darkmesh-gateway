# Trust Model & Integrity Roadmap (Notes)

This document is a design note for the BlackCat trust system. The key idea is:

> Encryption is only as strong as the **trust model** around keys, config, and code provenance.

Even “perfect crypto” cannot protect a system that can be silently reconfigured (tampered files, swapped modules, modified generated code).

## Goals

- Make the platform **tamper-evident by default** (and optionally tamper-resistant with higher tiers).
- Provide a clear **trust chain** from “official release” → “installed system” → “runtime execution”.
- Prevent/mitigate common real-world compromises (FTP mistakes, shared hosting, weak file permissions, partial updates).
- Keep the ecosystem modular: core libraries stay IO-free; CLI/monitoring/updater are separate repos.

## Post-quantum readiness (why “extreme” becomes baseline)

The “post‑quantum era” mostly threatens **asymmetric crypto** (signatures, key exchange). Symmetric crypto (AEAD/HMAC) is much less impacted (usually “use 256-bit keys”), but the **trust layer** (supply-chain signatures, transparency logs, installer bootstrap) is signature-heavy and must stay upgradeable.

Design principles:
- **Crypto agility**: all integrity metadata must carry explicit `algorithm` identifiers, key ids, and allow future formats without breaking verifiers.
- **Multi-signature support**: manifests should allow multiple signatures (e.g. classical + PQ) during migration.
- **Key agility**: pinned roots must support rotation and overlap windows (multiple trusted public keys).
- **Hybrid verification policy**: tier-based rules like “require classical+PQ” (extreme), “require at least one” (high), etc.

Also note: “decentralized anchoring” (Web3 / transparency logs) improves auditability, but it does not remove the need for a pinned root-of-trust. In practice you need **both**: (a) signed manifests and (b) an out-of-band anchor.

## Threats / gaps we must close

1) **No provenance check after install**
   - An attacker can replace files/modules and the system will happily run them.
2) **Config / generated file tampering**
   - On many hosts, attackers get filesystem write via FTP, a leaked token, or a weak maintenance process.
3) **Network downgrade during setup**
   - If admin bootstrap happens over HTTP, secrets (generated passwords, session tokens) are observable.

## Trust system primitives (building blocks)

### 1) Signed integrity manifests (release provenance)

Each release publishes:
- `integrity.json` (checksums + metadata)
- `integrity.sig` (signature)

`integrity.json` should minimally include:
- component name + version (and commit/tag)
- list of files with `sha256` (or a tree hash / Merkle root for large sets)
- build metadata (created_at, builder id, tooling version)

Verification must be based on **pinned public keys** (root-of-trust). HTTPS to GitHub helps, but is not sufficient alone.

Where to host:
- dedicated repo like `blackcat-checksums` / `blackcat-trust-store`, or
- GitHub Release assets per repository.

### 2) Installation snapshot (local provenance)

On install, generate a local snapshot:
- `installed.json` (what was installed + hashes + config pointers)
- `installed.sig` (signed)

This snapshot becomes the baseline for runtime checks and for “outside the system” monitoring.

### 3) Signed generated artifacts (local anti-tamper)

Any file that BlackCat generates (config overlays, compiled templates, schema outputs, etc.) should be signed:
- `file.ext` + `file.ext.sig`

Recommended:
- **one key per purpose** (e.g. config-signing, schema-signing, template-signing)
- store private keys outside web root, with strict perms
- support “extreme tier”: signing via HSM/KMS (so local filesystem compromise cannot sign new files)

This is primarily **tamper-evident** (if the signing key lives on the same host). With KMS/HSM, it becomes closer to tamper-resistant.

### 4) Emergency response (“pause / safe mode”)

If a critical integrity check fails:
- fail-closed for security core (deny boot / deny writes / deny admin login)
- emit high-severity telemetry event for monitoring/alerting
- optionally create a “maintenance lock” file that upstream tooling understands (installer/deployer)

Behavior must be tiered and configurable, but **no silent bypass** in production.

## Out-of-band verification (“must be checked outside the system”)

To defend against “host is compromised” scenarios, integrity must also be checked externally:
- CI/CD pipeline verifies the deployed tree matches signed manifests before switching traffic.
- A watchdog/agent (separate container/host) periodically validates checksums and alerts on drift.

This should become a standard integration for `blackcat-monitoring` / `blackcat-observability`.

## Transparency log / Web3 anchoring (baseline, tiered)

Web3 (or any append-only transparency log) can be used as an **external, decentralized anchor** for integrity.
In v1 BlackCat, this is the intended **baseline** trust authority for production deployments, with tiered modes:
- `root+uri` (cheap baseline): anchor the root plus a content pointer,
- `full detail` (paranoid): anchor more on-chain detail (costly).

Typical use:
- publish a Merkle root of `integrity.json` (or of the full release tree) into a public ledger,
- later prove “this deployed tree matches that anchored root” (tamper-evident, globally timestamped).

Important notes:
- It is a strong approach for **decentralized auditability**, but it is not the only valid model (TUF/Sigstore-style logs + pinned keys can also work).
- A blockchain does not replace signing keys: you still need a **root-of-trust** (pinned public keys, pinned chain + contract address).
- The anchor must be verified **out-of-band** (sentinel/CI), otherwise a compromised host can simply skip checks.

### ZK proofs (optional)

ZK proofs can be useful when you want to prove integrity/compliance **without leaking details**, e.g.:
- prove membership of specific files in a Merkle tree without publishing the full file list,
- prove “build came from an approved pipeline” without disclosing internal build metadata.

Trade-offs: complexity, cost, and operational burden. This should be an opt-in “extreme tier” feature.

## Secure bootstrap / installer requirements (high-level)

- Admin bootstrap **requires HTTPS** (otherwise admin credentials must not be created/accepted).
- If FTP/SFTP is used for bootstrap:
  - allow it only for the minimum time window,
  - then disable/restrict it (policy + checklist + warning telemetry).
- Generated admin password must be considered a temporary token:
  - require immediate password change,
  - optionally confirm the session out-of-band (email, magic link, WebAuthn).
- If `blackcat-jwt` is present, use it to harden session/bootstrap flows (short-lived tokens, audience binding, rotation).

## Proposed repository split (to keep core libraries clean)

**Libraries (no IO / no network / no CLI side effects):**
- `blackcat-integrity` — hashing, signature verification, manifest parsing, policy decisions.
- `blackcat-config` — runtime config + permission checks + validators (this repo).
- `blackcat-crypto` — crypto primitives/services (already exists).
- `blackcat-core` — minimal kernel (must remain usable standalone).

**IO / platform tooling:**
- `blackcat-cli` — unified CLI entrypoint + commands (no hard dependency for runtimes without CLI).
- `blackcat-installer` / `blackcat-install` — secure install + bootstrap enforcement.
- `blackcat-updater` — secure update client (TUF-like flow, signed metadata).
- `blackcat-sentinel` (or `blackcat-guard`) — out-of-band integrity watchdog/agent.
- `blackcat-monitoring` / `blackcat-observability` — dashboards, alerts, telemetry sinks.

## Suggested staged rollout

1) Define `integrity.json` schema + Ed25519 signature format; publish in CI for a single repo.
2) Implement verifier in `blackcat-integrity` and expose in `blackcat-config` as a small API + CLI command.
3) Integrate into installer/deployer: verify before enabling traffic / before creating admin credentials.
4) Add runtime checks for critical files (config + keys dir + generated artifacts), plus emergency safe-mode.
5) Add out-of-band sentinel + monitoring/alerting templates.
6) Marketplace/signers: extension developers get signing keys and an allowlist policy (governance).
7) (Extreme tier) Add transparency log / Web3 anchoring + optional ZK proofs for privacy-preserving attestations.
