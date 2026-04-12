# BlackCat Installer

Automated installer that turns a module selection (auth, database, observability, governance, …) into a runnable environment.
It is designed to work both manually (CLI) and as an AI-driven workflow: an agent produces a module list and the installer plans dependency installs, database bootstraps, and docker-compose steps.

## Responsibilities
- Reads the module catalog (`modules.json`; later: `blackcat-modules`).
- Installs dependencies (Composer / npm) for selected modules.
- Generates env overlays / runtime config snippets.
- Runs module bootstrap hooks (e.g. `php bin/auth-http --init`).
- Integrates with CI and AI agents (prompt → module list → plan/apply).

This repository currently contains a skeleton (see `docs/ROADMAP.md`). Next milestones: real Composer/npm dispatch, docker-compose templates, and trust-kernel gated bootstraps.

## Stage 3 (Kernel minimal / FTP)

Stage 3 introduces a “kernel minimal bundle” intended for constrained environments (shared hosting / FTP) where you **cannot** run Composer on the server.

- Template: `templates/kernel-minimal/`
- Build script: `scripts/build-kernel-minimal-bundle.sh`
- Docs: `docs/STAGE3_KERNEL_MINIMAL_BUNDLE.md`
- Hosting preflight (single-file): `tools/blackcat-preflight.php` (upload → run → delete)
- Hosting note: some hostings cannot safely run the web installer (missing TLS verification / outbound HTTPS). In that case, prepare the bundle offline on a trusted device and upload the final artifacts.
- Build note: the Stage 3 build script will build `site/vendor/` using **host Composer** if available, otherwise it falls back to a **Docker-based Composer** build (recommended).
- Local demo (HTTPS): `docker compose -f docker-compose.stage3-demo.yml up --build` → `https://localhost:8449/_blackcat/setup`
- Live editing: `docker compose -f docker-compose.stage3-demo.yml -f docker-compose.stage3-demo.dev.yml up --build`

## CLI (Stage 1)

```bash
# List available modules
php bin/installer list

# Install selected modules (logs actions and generates `.blackcat/env.generated`)
php bin/installer install --modules=auth-core,observability

# Enable feature views (adds `BC_INCLUDE_FEATURE_VIEWS=1` to the generated env and to bootstrap env)
php bin/installer install --modules=auth-core --include-feature-views

# Change output path or disable env generation
php bin/installer install --modules=auth-core --env-out=config/.env.blackcat
php bin/installer install --modules=observability --no-env

# Disable bootstrap hooks
php bin/installer install --modules=auth-core --no-bootstrap
```

The CLI reads `modules.json` and prints which Composer/npm/docker steps would be needed. It also generates an env file by merging module variables and runs bootstrap commands defined in the catalog (e.g. `php bin/auth-http --init`). Future stages will execute Composer/npm for real and add docker-compose scaffolding.

## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
