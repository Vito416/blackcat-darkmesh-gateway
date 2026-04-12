# Config Hub – Roadmap

## Stage 1 – Foundation ✅
- Loader aggregates defaults + profiles and exposes CLI (`profile:*`, `integration:*`, `security:*`, `telemetry:*`).
- `profiles.php` includes dev/staging/prod profiles + env templates, telemetry, and integrations for installer/database/messaging/governance.
- Telemetry (.ndjson) and smoke test (`composer test`) keep baseline coverage; CLI UX is provided by `blackcat-cli` (`blackcat verify`, `blackcat config …`, `blackcat trust …`).

## Stage 2 – Installer Integration
- Generate `installer.yaml` / env overlays for `blackcat-installer` and `blackcat-deployer`.
- CLI command `installer:plan` describes changes between profiles (env variable diff).
- Send telemetry feed into `blackcat-observability`.

## Stage 3 – Secrets Management (Vault integration)
- Define secret backends, map role-id/tokens, and provide CLI for seeding the secret store.
- `security:check` validates Vault/KMS integration and audits secret placeholders.

## Stage 4 – Cross-Ecosystem Automation
- Wire blackcat-config services into installer/orchestrator pipelines for push-button deployments.
- Expand contract tests covering dependencies listed in ECOSYSTEM.md.
- Publish metrics/controls so observability, security, and governance repos can reason about blackcat-config automatically.

## Stage 5 – Trust & Integrity (Supply Chain + Web3)
- Signed integrity manifests (checksums + signatures) for official releases.
- Web3 anchoring as the default “trust authority” baseline:
  - per-install on-chain controller contract records the attested state (install + upgrades),
  - tiered modes: `root+uri` (cheap) vs `full detail` (paranoid/costly).
- Runtime config becomes the only source of truth for trust-critical settings (no env bypass):
  - `trust.web3.chain_id`, `trust.web3.rpc_endpoints[]`, `trust.web3.rpc_quorum`,
  - `trust.web3.max_stale_sec` (recommended prod default: `180`),
  - `trust.web3.mode` (`root_uri` | `full`),
  - `trust.web3.contracts.*` (registry + per-install controller addresses),
  - `trust.web3.tx_outbox_dir` for buffered transactions during RPC outages.
  - `trust.integrity.root_dir`, `trust.integrity.manifest` (local verification inputs),
  - enforcement is bound to the on-chain policy hash (`InstanceController.activePolicyHash`) to avoid config-based downgrades.
- Auto-recommend the **best writable runtime config location** per host:
  - prefer real POSIX-permissioned filesystems (e.g. `/etc/blackcat/`, `/var/lib/blackcat/`),
  - detect “weak” mounts (e.g. `/mnt/c` on Windows) and downgrade to “dev/warn-only” unless explicitly overridden.
- Installer/deployer gates: refuse to enable traffic on mismatch (prod), produce explicit warnings (dev).
- Runtime safe-mode on detected tampering (no silent bypass in production profiles).
- Out-of-band watchdog/sentinel integration (monitoring/alerting + CI/CD preflight checks).

## Stage 6 – Continuous AI Augmentation
- Ship AI-ready manifests/tutorials enabling GPT installers to compose blackcat-config stacks autonomously.
- Add self-healing + policy feedback loops leveraging blackcat-agent, blackcat-governance, and marketplace signals.
- Feed anonymized adoption data to blackcat-usage and reward contributors via blackcat-payout.
