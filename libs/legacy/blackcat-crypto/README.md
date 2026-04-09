![BlackCat Crypto](.github/blackcat-crypto-banner.png)

# BlackCat Crypto

[![CI](https://github.com/blackcatacademy/blackcat-crypto/actions/workflows/ci.yml/badge.svg)](https://github.com/blackcatacademy/blackcat-crypto/actions/workflows/ci.yml)

Centralized cryptography services for the BlackCat ecosystem: AEAD encryption, HMAC, KMS wrapping, and key rotation.

The goal is to keep crypto logic in one place, so other modules can depend on a single audited implementation and avoid handling raw keys directly.

## Features

- **Double-envelope encryption**: local AEAD + optional KMS wrapping.
- **Slot-based keying**: separate keys for each use case (AEAD/HMAC/etc), with versioned key files.
- **Rotation-safe HMAC**: multi-key verification + `keyId`/candidates for DB patterns.
- **KMS routing**: pluggable clients (HTTP/HSM), health reporting, suspend/resume.
- **Async rotation queue**: queue-backed rewrap via CLI (`wrap:queue`).
- **Zero-boilerplate bootstrap**: `PlatformBootstrap::boot()` wires runtime config + optional bridges.

## Install

```bash
composer require blackcat/crypto
```

## Quick start (local keys)

Recommended: configure `blackcatacademy/blackcat-config` runtime config with:

- `crypto.keys_dir`
- `crypto.manifest`

Then `PlatformBootstrap::boot()` auto-discovers it (no env required).

Example runtime config (`/etc/blackcat/config.runtime.json`):

```json
{
  "crypto": {
    "keys_dir": "/etc/blackcat/keys",
    "manifest": "/etc/blackcat/crypto/contexts/core.json"
  }
}
```

```bash
blackcat crypto manifest:validate /etc/blackcat/crypto/contexts/core.json
blackcat crypto key:rotate core.crypto.default /etc/blackcat/keys --manifest=/etc/blackcat/crypto/contexts/core.json
blackcat crypto key:rotate core.hmac.email /etc/blackcat/keys --manifest=/etc/blackcat/crypto/contexts/core.json --length=64
blackcat crypto keys:lint --manifest=/etc/blackcat/crypto/contexts/core.json --keys-dir=/etc/blackcat/keys
```

Then in PHP:

```php
use BlackCat\Crypto\Bootstrap\PlatformBootstrap;

$crypto = PlatformBootstrap::boot();

$envelope = $crypto->encryptContext('users.pii', $plaintext);
$plaintext = $crypto->decryptContext('users.pii', $envelope->encode());
```

## Database encryption (blackcat-database-crypto)

This repository intentionally contains **no database code**. For transparent DB encryption/HMAC on write paths (create/update/upsert) use:

- `blackcatacademy/blackcat-database`
- `blackcatacademy/blackcat-database-crypto`

With those packages installed, `PlatformBootstrap::boot()` can configure the DB ingress locator automatically.

In the BlackCat ecosystem, DB ingress is configured via `blackcatacademy/blackcat-config` runtime config:

- `crypto.keys_dir`
- `crypto.manifest`

And the per-package encryption maps in `blackcatacademy/blackcat-database`:

- `packages/<package>/schema/encryption-map.json`

## CLI

```
blackcat crypto help
blackcat crypto key:rotate core.crypto.default keys/ --manifest=../blackcat-crypto-manifests/contexts/core.json
blackcat crypto keys:lint --manifest=../blackcat-crypto-manifests/contexts/core.json --keys-dir=./keys
blackcat crypto wrap:status storage/envelopes/123.json
blackcat crypto kms:diag
blackcat crypto wrap:queue status --limit 10
blackcat crypto wrap:queue run --limit 25 --dump-dir=/tmp/rewrap
blackcat crypto manifest:show --output=/tmp/manifest.json
blackcat crypto vault:diag storage/files/
blackcat crypto vault:migrate storage/files/foo.enc storage/files/foo.envelope
blackcat crypto vault:decrypt storage/files/foo.enc --output=/tmp/foo.txt
blackcat crypto metrics:export prom
blackcat crypto telemetry:sse --interval=5
blackcat crypto telemetry:intents --format=prom --limit=25
blackcat crypto kms:watchdog --interval=30
blackcat crypto kms:suspend hsm-primary 600
blackcat crypto kms:resume hsm-primary
blackcat crypto gov:assess --tenant=acme --sensitivity=low --amount=500
blackcat crypto vault:coverage var/ingress.ndjson --table --top=5
blackcat crypto manifest:validate ../blackcat-crypto-manifests/contexts/core.json --json
blackcat crypto key:rotate app.hsm keys/
```

Note: `key:generate` is deprecated and kept only as an alias for `key:rotate`.

## Core bridge (blackcat-core ↔ blackcat-crypto)

If `blackcat-core` is installed, legacy classes can delegate crypto to this package through `BlackCat\Crypto\Bridge\CoreCryptoBridge`.

## Shared manifests

The `blackcat-crypto-manifests` repo contains shared JSON manifests (`contexts/*.json`):

```bash
# compare manifests (e.g. CI)
blackcat crypto manifest:diff --from=../blackcat-crypto-manifests/contexts/core.json --to=../env/prod/manifest.json --json
```

## Documentation

- `docs/INTEGRATION.md`
- `docs/EXAMPLES.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ROADMAP.md`
- `docs/RELEASE_NOTES.md`

## Development

- Requirements: PHP 8.3+, ext-sodium, Composer.
- Install deps + dev tools: `composer install`
- Run tests: `composer test`
- Static analysis: `composer stan`
- Docker build (optional): `docker build -t blackcat-crypto .`
- Run tests in container:
  ```bash
  docker run --rm -v $(pwd):/app -w /app blackcat-crypto vendor/bin/phpunit
  ```
- Or via compose: `docker-compose run --rm crypto`

## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
