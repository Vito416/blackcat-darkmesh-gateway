# BlackCat Installer — Roadmap

## Stage 1 — Skeleton ✅
- CLI `blackcat-installer list/install` reads `modules.json`.
- Dry-run logging only (prepares for composer/npm dispatch).

## Stage 2 — Bootstrap workflows (in progress)
- ✅ Generate `.env` overlays from module variables (`--env-out`, `--no-env`).
- ✅ Bootstrap runner (executes `bootstrap` commands; optional `--no-bootstrap`).
- ▢ Templates for docker-compose stacks (monitoring, database).

## Stage 3 — Trust Kernel bootstrap (planned)
- Verify official releases before any privileged action:
  - verify signed integrity manifests (checksums + signatures),
  - verify the Web3 anchor (ReleaseRegistry + per-install InstanceController).
- Provide a “minimal install” mode:
  - ✅ kernel-minimal bundle template (`templates/kernel-minimal/`)
  - ✅ token-gated one-time setup UI (`/_blackcat/setup`)
  - ✅ build helper script (`scripts/build-kernel-minimal-bundle.sh`)
  - target server installs only `blackcat-core` (+ deps) and a file-based runtime config
  - no CLI requirement on the target (works even in constrained environments)
- Multi-device approval ceremony (N-of-M signers) to:
  - clone/create the per-install controller contract,
  - pin the chosen trust mode (`root+uri` vs `full`) and policy,
  - register emergency + upgrade authorities.
- Enforce secure bootstrap:
  - refuse to create/accept admin credentials without HTTPS (best available mechanism),
  - in strict mode, record a bootstrap event hash on-chain (tamper-evident audit trail).

## Stage 4 — AI Integration
- REST API + OpenAI agent workflow (prompt → modules): `installer ai-setup "project needs auth + analytics"`.

## Stage 5 — Frontend org support
- Auto-clone FE repos, install UI modules, link them with backend modules.

## Stage 6 — Cloud deploy
- Provisioning Terraform/helm templates, multi-env pipeline.
